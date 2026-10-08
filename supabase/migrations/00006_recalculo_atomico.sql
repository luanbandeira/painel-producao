-- =============================================================
-- Migration 00006 — Recálculo atômico da produção
--
-- Problema corrigido: o recálculo apagava production_intervals e reinseria
-- em requisições separadas. Duas execuções simultâneas (ex.: confirmar um
-- upload e clicar em "Recalcular produção" ao mesmo tempo) se intercalavam:
--   A: DELETE ... B: DELETE ... A: INSERT ... B: INSERT
-- deixando registros de duas versões na tabela. Resultado: a mesma produção
-- contada duas vezes, inflando o Volume.
-- =============================================================

-- 1. Remove eventuais duplicatas remanescentes, mantendo a versão mais alta
delete from public.production_intervals a
using public.production_intervals b
where a.client_id = b.client_id
  and a.period_start = b.period_start
  and a.period_end = b.period_end
  and (a.calculation_version < b.calculation_version
       or (a.calculation_version = b.calculation_version and a.id < b.id));

-- 2. Barreira estrutural: o banco passa a recusar duplicatas, mesmo que
--    algum caminho de código falhe no futuro
alter table public.production_intervals
  add constraint uq_producao_cliente_periodo
  unique (client_id, period_start, period_end);

-- 3. Substituição atômica: apaga e reinsere numa única transação, serializada
--    por advisory lock. Chamadas simultâneas passam a esperar sua vez em vez
--    de se sobrepor.
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

  -- WHERE explícito: o Supabase recusa DELETE sem cláusula WHERE
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
