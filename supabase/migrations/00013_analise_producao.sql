-- =============================================================
-- Migration 00013 — Agregações para a seção de análise
--
-- A seção precisa de três recortes que, montados linha a linha, custariam
-- milhares de intervalos por carregamento (e dois meses de cada vez):
--
--   producao_por_dia    → a série diária, para o gráfico e a média
--   dias_com_producao   → em quantos dias distintos cada cliente produziu,
--                         que é a base de "produção constante"
--
-- Ambas SECURITY INVOKER (o padrão): o RLS de production_intervals continua
-- valendo, então o gestor vê a base e o vendedor veria só a carteira
-- dele. NÃO trocar por SECURITY DEFINER.
-- =============================================================

/**
 * Série diária do período. Só granularidade DAILY: intervalo agregado cobre
 * vários dias e não tem como ser dividido entre eles, então
 * distorceria a média diária.
 */
create or replace function public.producao_por_dia(
  p_inicio date,
  p_fim    date
)
returns table (
  dia        date,
  volume        numeric,
  pedidos bigint,
  clientes   bigint
)
language sql
stable
as $$
  select
    period_end                        as dia,
    coalesce(sum(volume_delta), 0)       as volume,
    coalesce(sum(order_delta), 0)::bigint as pedidos,
    count(distinct client_id)::bigint as clientes
    from public.production_intervals
   where calculation_status = 'VALID'
     and granularity = 'DAILY'
     and period_end >= p_inicio
     and period_end <= p_fim
   group by period_end
   order by period_end;
$$;

/**
 * Em quantos dias distintos cada cliente produziu de fato (delta positivo).
 * Dia com delta zero não conta como compra.
 */
create or replace function public.dias_com_producao(
  p_inicio date,
  p_fim    date
)
returns table (
  client_id uuid,
  dias      bigint,
  volume       numeric
)
language sql
stable
as $$
  select
    client_id,
    count(distinct period_end)::bigint as dias,
    coalesce(sum(volume_delta), 0)        as volume
    from public.production_intervals
   where calculation_status = 'VALID'
     and volume_delta > 0
     and period_end >= p_inicio
     and period_end <= p_fim
   group by client_id;
$$;

grant execute on function public.producao_por_dia(date, date)
  to authenticated, service_role;
grant execute on function public.dias_com_producao(date, date)
  to authenticated, service_role;
