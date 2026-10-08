-- =============================================================
-- Migration 00011 — Snapshot mais recente por cliente
--
-- O contador de "dias sem comprar" aparece em seis telas. Para montá-lo, o
-- sistema baixava TODOS os snapshots ativos e ficava com o primeiro de cada
-- cliente — hoje são 5.839 linhas, das quais só 171 interessam, em seis
-- idas e voltas ao banco, uma depois da outra. E cresce a cada upload.
--
-- O `distinct on` resolve isso no banco: uma linha por cliente, a de
-- cobertura mais recente. Uma consulta, 171 linhas.
--
-- `security_invoker = on` é essencial: sem isso a view rodaria com os
-- privilégios de quem a criou e furaria o RLS, entregando a base inteira ao
-- vendedor. Com ele, a policy sel_client_snapshots continua valendo
-- normalmente para quem consulta.
-- =============================================================

create or replace view public.client_latest_snapshot
with (security_invoker = on) as
select distinct on (s.client_id)
  s.client_id,
  s.coverage_end_date,
  s.last_purchase_date,
  s.days_without_purchase
from public.client_snapshots s
where s.status = 'ACTIVE'
order by s.client_id, s.coverage_end_date desc;

grant select on public.client_latest_snapshot to authenticated, service_role;

-- Sustenta o distinct on sem varrer a tabela toda
create index if not exists idx_client_snapshots_recente
  on public.client_snapshots (client_id, coverage_end_date desc)
  where status = 'ACTIVE';
