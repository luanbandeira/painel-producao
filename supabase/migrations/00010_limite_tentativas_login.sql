-- =============================================================
-- Migration 00010 — Freio para tentativas repetidas de login
--
-- A ação de login é a única entrada executável sem sessão: qualquer pessoa
-- na internet pode chamá-la em sequência. O Supabase aplica limites próprios
-- por IP, mas eles não são configuráveis por nós.
--
-- Guardamos só as tentativas que FALHARAM, e apenas o suficiente para contar:
-- IP de origem e e-mail digitado. Nada de senha, nunca.
--
-- Sem policy de RLS de propósito: a tabela é inacessível a qualquer usuário
-- autenticado ou anônimo — só o servidor, com a chave de serviço, escreve e
-- lê. Se fosse alcançável pela chave publicável, um atacante poderia
-- registrar falhas em nome de outra pessoa e trancá-la de fora.
-- =============================================================

create table public.login_attempts (
  id         bigserial primary key,
  ip         varchar not null,
  email      varchar not null,
  created_at timestamptz not null default now()
);

-- A consulta é sempre "falhas deste IP na última janela"
create index idx_login_attempts_ip on public.login_attempts (ip, created_at desc);
create index idx_login_attempts_limpeza on public.login_attempts (created_at);

alter table public.login_attempts enable row level security;

-- Nenhuma policy: nem anon nem authenticated enxergam ou escrevem
grant all on public.login_attempts to service_role;
grant usage, select on sequence public.login_attempts_id_seq to service_role;
