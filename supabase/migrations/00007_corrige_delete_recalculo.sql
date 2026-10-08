-- =============================================================
-- Migration 00007 — Ajuste na função de recálculo atômico
--
-- O Supabase bloqueia DELETE sem cláusula WHERE ("DELETE requires a WHERE
-- clause"), proteção que também vale dentro de funções. A limpeza da tabela
-- passa a usar um predicado explícito.
-- =============================================================

create or replace function public.replace_production_intervals(p_intervals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_count   integer;
begin
  -- Serializa recálculos concorrentes (liberado no fim da transação)
  perform pg_advisory_xact_lock(hashtext('recalculo_producao'));

  select coalesce(max(calculation_version), 0) + 1
    into v_version
    from production_intervals;

  delete from production_intervals where id is not null;

  insert into production_intervals (
    client_id, previous_snapshot_id, current_snapshot_id,
    period_start, period_end, day_count, volume_delta, order_delta,
    granularity, calculation_status, assigned_seller_id, calculation_version
  )
  select
    (x ->> 'client_id')::uuid,
    nullif(x ->> 'previous_snapshot_id', '')::uuid,
    (x ->> 'current_snapshot_id')::uuid,
    (x ->> 'period_start')::date,
    (x ->> 'period_end')::date,
    (x ->> 'day_count')::integer,
    nullif(x ->> 'volume_delta', '')::decimal(18,2),
    nullif(x ->> 'order_delta', '')::bigint,
    (x ->> 'granularity')::production_granularity,
    (x ->> 'calculation_status')::calculation_status,
    nullif(x ->> 'assigned_seller_id', '')::uuid,
    v_version
  from jsonb_array_elements(p_intervals) as x;

  get diagnostics v_count = row_count;

  return jsonb_build_object('version', v_version, 'count', v_count);
end;
$$;

revoke execute on function public.replace_production_intervals(jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_production_intervals(jsonb) to service_role;
