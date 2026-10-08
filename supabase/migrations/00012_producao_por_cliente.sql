-- =============================================================
-- Migration 00012 — Produção do período somada no banco
--
-- A tela de clientes precisa de dois números por cliente: o Volume do período e
-- quanto ele produziu no último dia apurado. Para chegar neles, o sistema
-- trazia os intervalos linha a linha e somava em memória. No começo do mês
-- são poucas centenas de linhas; no fim, um intervalo por cliente por dia —
-- perto de cinco mil, em várias idas ao banco, uma esperando a outra.
--
-- Somar aqui devolve uma linha por cliente, sempre, em uma consulta só.
--
-- SECURITY INVOKER (o padrão para funções): o RLS de production_intervals
-- continua valendo para quem chama, então o vendedor soma apenas a
-- própria carteira. NÃO trocar por SECURITY DEFINER.
--
-- As regras replicam exatamente o que a tela fazia antes:
--   - só intervalos com calculation_status = 'VALID';
--   - Volume do período soma todas as granularidades (diária e agregada);
--   - "último dia" é o maior period_end entre os intervalos DIÁRIOS válidos,
--     e a coluna soma apenas os diários daquele dia.
-- =============================================================

create or replace function public.producao_por_cliente(
  p_inicio date,
  p_fim    date
)
returns table (
  client_id      uuid,
  volume            numeric,
  pedidos     bigint,
  volume_ultimo_dia numeric,
  ultimo_dia     date
)
language sql
stable
as $$
  with validos as (
    select client_id, volume_delta, order_delta, granularity, period_end
      from public.production_intervals
     where calculation_status = 'VALID'
       and period_end >= p_inicio
       and period_end <= p_fim
  ),
  ultimo as (
    select max(period_end) as dia from validos where granularity = 'DAILY'
  )
  select
    v.client_id,
    coalesce(sum(v.volume_delta), 0)                       as volume,
    coalesce(sum(v.order_delta), 0)::bigint       as pedidos,
    coalesce(
      sum(v.volume_delta) filter (
        where v.granularity = 'DAILY'
          and v.period_end = (select dia from ultimo)
      ), 0
    )                                                    as volume_ultimo_dia,
    (select dia from ultimo)                             as ultimo_dia
    from validos v
   group by v.client_id;
$$;

grant execute on function public.producao_por_cliente(date, date)
  to authenticated, service_role;

-- Sustenta o recorte por período
create index if not exists idx_production_intervals_periodo
  on public.production_intervals (period_end)
  where calculation_status = 'VALID';
