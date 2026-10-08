-- =============================================================
-- Migration 00005 — Visibilidade de campanhas para vendedores
--
-- Vendedor passa a enxergar apenas campanhas ATIVAS. Rascunhos (ainda
-- sendo montados), encerradas e canceladas ficam restritos a gestão.
-- A regra vale no banco, não só na interface.
-- =============================================================

drop policy if exists sel_campaigns on public.campaigns;

create policy sel_campaigns on public.campaigns
  for select to authenticated
  using (public.is_staff() or status = 'ATIVA');

-- As metas acompanham a visibilidade da campanha a que pertencem
drop policy if exists sel_campaign_goals on public.campaign_goals;

create policy sel_campaign_goals on public.campaign_goals
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.campaigns c
      where c.id = campaign_goals.campaign_id
        and c.status = 'ATIVA'
    )
  );

-- Participantes seguem a mesma regra: além de ser a própria linha, a
-- campanha precisa estar ativa
drop policy if exists sel_campaign_sellers on public.campaign_sellers;

create policy sel_campaign_sellers on public.campaign_sellers
  for select to authenticated
  using (
    public.is_staff()
    or (
      seller_id = public.my_seller_id()
      and exists (
        select 1
        from public.campaigns c
        where c.id = campaign_sellers.campaign_id
          and c.status = 'ATIVA'
      )
    )
  );
