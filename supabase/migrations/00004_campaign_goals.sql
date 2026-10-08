-- =============================================================
-- Migration 00004 — Metas individuais por campanha ("quests")
--
-- Além da meta geral (campaigns.target_value), cada campanha pode ter N
-- metas que valem para CADA vendedor participante. Exemplos:
--   - acumular R$ 100.000,00 de Volume no período
--   - captar 10 novos clientes no período
-- =============================================================

create type campaign_goal_metric as enum (
  'VOLUME',                -- soma dos deltas válidos do vendedor no período
  'ORDERS',       -- soma dos deltas de pedidos
  'NEW_CLIENTS',        -- clientes da carteira vistos pela 1ª vez no período
  'PRODUCING_CLIENTS'   -- clientes da carteira com produção > 0 no período
);

create table public.campaign_goals (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  metric        campaign_goal_metric not null,
  target_value  decimal(18,2) not null,
  label         varchar,             -- nome opcional da quest
  created_at    timestamptz not null default now(),

  constraint chk_goal_target_positive check (target_value > 0),
  constraint uq_goal_campaign_metric unique (campaign_id, metric)
);

create index idx_campaign_goals_campaign on public.campaign_goals (campaign_id);

-- Grants (o schema já tem default privileges, mas explicitar evita 42501
-- caso a migration seja executada por outro papel)
grant all on public.campaign_goals to service_role;
grant select, insert, update, delete on public.campaign_goals to authenticated;

-- RLS: metas são visíveis a todos os autenticados (o vendedor precisa
-- ver a própria quest). A escrita continua exclusiva do backend.
alter table public.campaign_goals enable row level security;

create policy sel_campaign_goals on public.campaign_goals
  for select to authenticated using (true);
