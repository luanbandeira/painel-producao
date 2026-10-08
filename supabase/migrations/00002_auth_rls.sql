-- =============================================================
-- Migration 00002 — Autenticação, GRANTs e políticas de RLS
-- Inclui a correção dos privilégios (o projeto retornava 42501
-- "permission denied" porque as tabelas foram criadas sem os
-- grants padrão para os papéis do Supabase).
-- =============================================================

-- -------------------------------------------------------------
-- 1. GRANTs de acesso
--    authenticated: leitura/escrita limitadas pelo RLS abaixo
--    service_role: acesso total (backend)
--    anon: nenhum acesso a dados (apenas login)
-- -------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to service_role, authenticated;

-- -------------------------------------------------------------
-- 2. Funções auxiliares de autorização
--    SECURITY DEFINER para não recair no RLS da própria users
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and active and role = 'ADMIN'
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and active and role in ('ADMIN', 'MANAGER')
  );
$$;

-- Vendedor ligado ao usuário logado (nulo para admin/gestor sem vínculo)
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select id from public.sellers where user_id = auth.uid() and active;
$$;

grant execute on function public.is_admin(), public.is_staff(), public.my_seller_id()
  to authenticated;

-- -------------------------------------------------------------
-- 3. Perfil automático ao criar usuário no Supabase Auth
--    Nome e papel vêm do user_metadata definido na criação
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
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'SELLER')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- 4. Políticas de RLS (somente leitura para authenticated)
--    Escritas acontecem exclusivamente pelo backend (service_role,
--    que ignora RLS) após verificação explícita de papel
-- -------------------------------------------------------------

-- users: staff vê todos; cada usuário vê o próprio perfil
create policy sel_users on public.users
  for select to authenticated
  using (public.is_staff() or id = auth.uid());

-- sellers: staff vê todos; vendedor vê o próprio cadastro
create policy sel_sellers on public.sellers
  for select to authenticated
  using (public.is_staff() or user_id = auth.uid());

create policy sel_seller_aliases on public.seller_aliases
  for select to authenticated
  using (public.is_staff());

-- clients: staff vê todos; vendedor vê clientes da própria carteira
create policy sel_clients on public.clients
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.client_assignments ca
      where ca.client_id = clients.id
        and ca.seller_id = public.my_seller_id()
        and ca.status = 'ACTIVE'
    )
  );

create policy sel_client_assignments on public.client_assignments
  for select to authenticated
  using (public.is_staff() or seller_id = public.my_seller_id());

-- uploads e pendências: apenas staff (vendedor não vê uploads)
create policy sel_imports on public.imports
  for select to authenticated using (public.is_staff());

create policy sel_import_rows on public.import_rows
  for select to authenticated using (public.is_staff());

create policy sel_import_issues on public.import_issues
  for select to authenticated using (public.is_staff());

-- snapshots: staff vê todos; vendedor vê os da própria carteira
create policy sel_client_snapshots on public.client_snapshots
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.client_assignments ca
      where ca.client_id = client_snapshots.client_id
        and ca.seller_id = public.my_seller_id()
        and ca.status = 'ACTIVE'
    )
  );

-- produção: staff vê tudo; vendedor vê a produção atribuída a ele
create policy sel_production_intervals on public.production_intervals
  for select to authenticated
  using (public.is_staff() or assigned_seller_id = public.my_seller_id());

-- campanhas: visíveis a todos os usuários autenticados
create policy sel_campaigns on public.campaigns
  for select to authenticated using (true);

create policy sel_campaign_sellers on public.campaign_sellers
  for select to authenticated
  using (public.is_staff() or seller_id = public.my_seller_id());

-- auditoria: somente administradores
create policy sel_audit_logs on public.audit_logs
  for select to authenticated using (public.is_admin());
