-- =============================================================
-- Migration 00003 — Fluxo de importação
-- Confirmação transacional do upload: tudo ou nada.
-- =============================================================

-- Mensagens de erro do processamento
alter table public.imports add column if not exists error_message text;

-- -------------------------------------------------------------
-- confirm_import: processa um upload em PREVIA dentro de UMA
-- transação. Se qualquer passo falhar, nada é persistido
-- (o chamador marca o upload como ERRO).
--
-- Passos:
--   1. trava o upload e a data (concorrência)
--   2. cadastra clientes novos e atualiza os existentes
--   3. gera um snapshot por linha válida
--   4. materializa as pendências detectadas na prévia
--   5. marca clientes ausentes em relação à base anterior
--   6. define status final: ATIVO ou COM_PENDENCIAS
-- -------------------------------------------------------------
create or replace function public.confirm_import(p_import_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import      imports%rowtype;
  r             record;
  v_nd          jsonb;
  v_code        text;
  v_client_id   uuid;
  v_new_clients integer := 0;
  v_valid       integer := 0;
  v_issues      integer := 0;
  v_blocking    integer := 0;
  v_base_import uuid;
  v_status      import_status;
begin
  select * into v_import from imports where id = p_import_id for update;
  if not found then
    raise exception 'IMPORT_NOT_FOUND';
  end if;
  if v_import.status <> 'PREVIA' then
    raise exception 'IMPORT_NOT_IN_PREVIEW';
  end if;

  -- Bloqueia confirmações simultâneas para a mesma data
  perform pg_advisory_xact_lock(hashtext('import_date_' || v_import.report_date::text));

  if exists (
    select 1 from imports
    where report_date = v_import.report_date
      and status in ('ATIVO', 'COM_PENDENCIAS')
      and id <> p_import_id
  ) then
    raise exception 'IMPORT_DATE_ALREADY_ACTIVE';
  end if;

  update imports set status = 'PROCESSANDO' where id = p_import_id;

  -- Linhas válidas e com aviso geram cliente + snapshot; linhas ERROR não
  for r in
    select * from import_rows
    where import_id = p_import_id and status <> 'ERROR'
    order by row_number
  loop
    v_nd := r.normalized_data;
    v_code := v_nd ->> 'client_code';
    if v_code is null then
      continue;
    end if;

    select id into v_client_id from clients where client_code = v_code;

    if v_client_id is null then
      insert into clients (
        client_code, document, display_name, unit, uf,
        situation, plan, channel, first_seen_at, last_seen_at
      ) values (
        v_code,
        v_nd ->> 'document',
        coalesce(v_nd ->> 'display_name', v_code),
        v_nd ->> 'unit',
        v_nd ->> 'uf',
        v_nd ->> 'situation',
        v_nd ->> 'plan',
        v_nd ->> 'channel',
        v_import.coverage_end_date,
        v_import.coverage_end_date
      ) returning id into v_client_id;
      v_new_clients := v_new_clients + 1;
    else
      update clients set
        document       = coalesce(v_nd ->> 'document', document),
        display_name   = coalesce(v_nd ->> 'display_name', display_name),
        unit        = coalesce(v_nd ->> 'unit', unit),
        uf             = coalesce(v_nd ->> 'uf', uf),
        situation      = coalesce(v_nd ->> 'situation', situation),
        plan          = coalesce(v_nd ->> 'plan', plan),
        channel = coalesce(v_nd ->> 'channel', channel),
        last_seen_at   = greatest(coalesce(last_seen_at, v_import.coverage_end_date), v_import.coverage_end_date),
        updated_at     = now()
      where id = v_client_id;
    end if;

    update import_rows set client_id = v_client_id where id = r.id;

    begin
      insert into client_snapshots (
        import_id, client_id, report_date, coverage_end_date,
        cumulative_volume, cumulative_orders, last_purchase_date,
        days_without_purchase, recency, source_seller_text, source_row_number
      ) values (
        p_import_id, v_client_id, v_import.report_date, v_import.coverage_end_date,
        (v_nd ->> 'cumulative_volume')::decimal(18,2),
        (v_nd ->> 'cumulative_orders')::bigint,
        (v_nd ->> 'last_purchase_date')::date,
        (v_nd ->> 'days_without_purchase')::integer,
        v_nd ->> 'recency',
        v_nd ->> 'seller_text',
        r.row_number
      );
      v_valid := v_valid + 1;
    exception when unique_violation then
      -- código repetido no arquivo que escapou da prévia (defesa extra)
      insert into import_issues (import_id, import_row_id, client_id, type, severity, details)
      values (
        p_import_id, r.id, v_client_id, 'DUPLICATE_CODE', 'BLOCKING',
        jsonb_build_object('row', r.row_number, 'code', v_code)
      );
    end;
  end loop;

  -- Materializa as pendências detectadas pelo parser na prévia
  insert into import_issues (import_id, import_row_id, client_id, type, severity, details)
  select
    p_import_id,
    ir.id,
    ir.client_id,
    (p ->> 'tipo')::issue_type,
    (p ->> 'severidade')::issue_severity,
    p
  from import_rows ir,
       jsonb_array_elements(coalesce(ir.normalized_data -> 'problemas', '[]'::jsonb)) p
  where ir.import_id = p_import_id;

  -- Clientes presentes na base anterior e ausentes neste arquivo
  select id into v_base_import
  from imports
  where status in ('ATIVO', 'COM_PENDENCIAS')
    and coverage_end_date < v_import.coverage_end_date
    and id <> p_import_id
  order by coverage_end_date desc
  limit 1;

  if v_base_import is not null then
    insert into import_issues (import_id, client_id, type, severity, details)
    select
      p_import_id, cs.client_id, 'CLIENT_MISSING', 'INFO',
      jsonb_build_object('base_import_id', v_base_import)
    from client_snapshots cs
    where cs.import_id = v_base_import
      and cs.status = 'ACTIVE'
      and not exists (
        select 1 from client_snapshots atual
        where atual.import_id = p_import_id and atual.client_id = cs.client_id
      );
  end if;

  select count(*),
         count(*) filter (where severity = 'BLOCKING' and status = 'OPEN')
    into v_issues, v_blocking
  from import_issues where import_id = p_import_id;

  v_status := case when v_blocking > 0 then 'COM_PENDENCIAS' else 'ATIVO' end;

  update imports set
    status       = v_status,
    valid_rows   = v_valid,
    new_clients  = v_new_clients,
    issue_count  = v_issues,
    confirmed_by = p_user_id,
    confirmed_at = now(),
    error_message = null
  where id = p_import_id;

  return jsonb_build_object(
    'status', v_status,
    'valid_rows', v_valid,
    'new_clients', v_new_clients,
    'issues', v_issues,
    'blocking_issues', v_blocking
  );
end;
$$;

-- Chamada exclusiva do backend (service_role), nunca direto pelo cliente
revoke execute on function public.confirm_import(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_import(uuid, uuid) to service_role;
