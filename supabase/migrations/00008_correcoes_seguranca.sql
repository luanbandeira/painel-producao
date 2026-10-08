-- =============================================================
-- Migration 00008 — Correções de segurança
--
-- 1. Escalonamento de privilégio: o gatilho de criação de perfil aceitava o
--    papel vindo do metadata do cadastro, que é controlado por quem chama.
--    Com o cadastro público aberto, qualquer pessoa podia criar uma conta
--    ADMIN. O papel passa a ser sempre SELLER na criação; quem promove
--    é a rotina administrativa, já autenticada como service_role.
--
-- 2. Usuário desativado mantinha acesso pela API: my_seller_id() olhava
--    apenas sellers.active, ignorando users.active. A interface
--    bloqueava, o banco não.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Gatilho: papel nunca vem do cliente
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    -- Sempre o papel de menor privilégio. Promoção é feita depois, pelo
    -- backend, nunca a partir de dados enviados no cadastro.
    'SELLER'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 2. Conta desativada perde acesso também no banco
-- -------------------------------------------------------------

/** Usuário autenticado existe e está ativo. */
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and active
  );
$$;

-- Passa a exigir que a CONTA esteja ativa, não só o cadastro de vendedor
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select p.id
    from public.sellers p
    join public.users u on u.id = p.user_id
   where p.user_id = auth.uid()
     and p.active
     and u.active;
$$;

grant execute on function public.is_active_user() to authenticated;

-- Campanhas: além de ativa, exige conta ativa e vínculo com vendedor.
-- Uma conta sem vínculo (ex.: criada indevidamente) não enxerga nada.
drop policy if exists sel_campaigns on public.campaigns;

create policy sel_campaigns on public.campaigns
  for select to authenticated
  using (
    public.is_staff()
    or (status = 'ATIVA' and public.my_seller_id() is not null)
  );

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
          and c.status = 'ATIVA'
      )
    )
  );
