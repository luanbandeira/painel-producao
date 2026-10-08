-- =============================================================
-- Migration 00009 — Vendedor enxerga a campanha que ele disputou
-- depois de encerrada
--
-- A 00005 restringiu o vendedor a campanhas ATIVAS. Na prática isso
-- apagou da tela dele justamente o momento que interessa: encerrada a
-- campanha, o participante perdia o acesso ao próprio resultado.
--
-- Passa a valer: ATIVA e ENCERRADA são visíveis. RASCUNHO (ainda sendo
-- montada) e CANCELADA seguem restritas à gestão. Continua exigida a conta
-- ativa com vínculo de vendedor, como na 00008.
--
-- Só leitura muda. Encerrada, a campanha continua sem permitir escrita —
-- reabrir é ação de administrador.
-- =============================================================

drop policy if exists sel_campaigns on public.campaigns;

create policy sel_campaigns on public.campaigns
  for select to authenticated
  using (
    public.is_staff()
    or (
      status in ('ATIVA', 'ENCERRADA')
      and public.my_seller_id() is not null
    )
  );

-- As metas acompanham a visibilidade da campanha a que pertencem
drop policy if exists sel_campaign_goals on public.campaign_goals;

create policy sel_campaign_goals on public.campaign_goals
  for select to authenticated
  using (
    public.is_staff()
    or (
      public.my_seller_id() is not null
      and exists (
        select 1
        from public.campaigns c
        where c.id = campaign_goals.campaign_id
          and c.status in ('ATIVA', 'ENCERRADA')
      )
    )
  );

-- Participantes: além de ser a própria linha, a campanha precisa estar
-- visível para o vendedor
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
          and c.status in ('ATIVA', 'ENCERRADA')
      )
    )
  );
