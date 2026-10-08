-- =============================================================
-- Migration 00001 — Modelo de dados inicial
-- Painel de Produção
-- =============================================================

-- Necessária para a restrição de não-sobreposição de atribuições
create extension if not exists btree_gist;

-- -------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------
create type user_role as enum ('ADMIN', 'MANAGER', 'SELLER');

create type assignment_origin as enum ('UPLOAD', 'MANUAL', 'CORRECTION');
create type assignment_status as enum ('ACTIVE', 'CLOSED', 'CANCELLED');

-- Situação do upload
create type import_status as enum (
  'RECEBIDO', 'VALIDANDO', 'PREVIA', 'PROCESSANDO', 'ATIVO',
  'COM_PENDENCIAS', 'SUBSTITUIDO', 'CANCELADO', 'ERRO', 'EXCLUIDO'
);

create type import_row_status as enum ('VALID', 'WARNING', 'ERROR');

create type snapshot_status as enum ('ACTIVE', 'INVALIDATED');

create type production_granularity as enum ('DAILY', 'AGGREGATED', 'UNKNOWN');

create type calculation_status as enum (
  'VALID', 'NO_BASE', 'NEGATIVE', 'PENDING', 'INVALIDATED'
);

-- Tipos de pendência
create type issue_type as enum (
  'NO_BASE',                 -- cliente sem base
  'UNKNOWN_SELLER',      -- vendedor desconhecido
  'SELLER_CHANGE',       -- alteração de responsável
  'INVALID_DOCUMENT',        -- documento inválido
  'DUPLICATE_CODE',          -- código duplicado
  'DUPLICATE_DOCUMENT',      -- mesmo documento em códigos diferentes (decisão #3)
  'NEGATIVE_VOLUME',            -- Volume negativo
  'NEGATIVE_ORDERS',   -- pedidos negativos
  'INCOMPATIBLE_DATE',       -- data incompatível
  'INVALID_ROW',             -- linha inválida
  'CLIENT_MISSING',          -- cliente ausente no arquivo
  'MISSING_INTERVAL',        -- intervalo sem upload
  'AGGREGATED_TRANSFER'      -- troca de responsável dentro de intervalo agregado
);

create type issue_severity as enum ('INFO', 'WARNING', 'BLOCKING');
create type issue_status as enum ('OPEN', 'RESOLVED', 'IGNORED');

create type campaign_status as enum ('RASCUNHO', 'ATIVA', 'ENCERRADA', 'CANCELADA');
create type campaign_metric as enum ('VOLUME', 'CLIENTS', 'ORDERS');

-- -------------------------------------------------------------
-- users — perfil da aplicação ligado ao Supabase Auth
-- (sem password_hash: as senhas ficam no Supabase Auth)
-- -------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        varchar not null,
  email       varchar not null unique,
  role        user_role not null default 'SELLER',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -------------------------------------------------------------
-- sellers
-- -------------------------------------------------------------
create table public.sellers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users (id),
  name             varchar not null,
  normalized_name  varchar not null,
  email            varchar,
  phone            varchar,
  active           boolean not null default true,
  entry_date       date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_sellers_normalized_name on public.sellers (normalized_name);

-- -------------------------------------------------------------
-- seller_aliases
-- -------------------------------------------------------------
create table public.seller_aliases (
  id                uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.sellers (id) on delete cascade,
  alias             varchar not null,
  normalized_alias  varchar not null unique,
  created_at        timestamptz not null default now()
);

-- -------------------------------------------------------------
-- clients
-- -------------------------------------------------------------
create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  client_code  varchar(20) not null unique,
  document            varchar(20),          -- somente dígitos, como texto
  display_name        varchar not null,
  unit             varchar,
  uf                  char(2),
  situation           varchar,
  plan               varchar,
  channel      varchar,
  active              boolean not null default true,
  first_seen_at       date,
  last_seen_at        date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_clients_document on public.clients (document);
create index idx_clients_display_name on public.clients (display_name);

-- -------------------------------------------------------------
-- client_assignments
-- Restrição: um cliente não pode ter dois períodos ativos sobrepostos
-- -------------------------------------------------------------
create table public.client_assignments (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id),
  seller_id  uuid not null references public.sellers (id),
  valid_from     date not null,
  valid_until    date,                      -- inclusiva; nula = vigente
  origin         assignment_origin not null,
  protected      boolean not null default false,
  status         assignment_status not null default 'ACTIVE',
  reason         text,
  created_by     uuid references public.users (id),
  created_at     timestamptz not null default now(),

  constraint chk_assignment_period check (valid_until is null or valid_until >= valid_from),

  -- intervalos de vigência não podem se sobrepor para o mesmo cliente
  constraint excl_assignment_overlap exclude using gist (
    client_id with =,
    daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[]') with &&
  ) where (status = 'ACTIVE')
);

create index idx_assignments_client on public.client_assignments (client_id);
create index idx_assignments_seller on public.client_assignments (seller_id);

-- -------------------------------------------------------------
-- imports
-- -------------------------------------------------------------
create table public.imports (
  id                   uuid primary key default gen_random_uuid(),
  report_date          date not null,
  coverage_end_date    date not null,
  file_name            varchar not null,
  file_storage_key     varchar not null,
  checksum_sha256      varchar not null,
  version              integer not null default 1,
  status               import_status not null default 'RECEBIDO',
  total_rows           integer,
  valid_rows           integer,
  new_clients          integer,
  issue_count          integer,
  uploaded_by          uuid not null references public.users (id),
  uploaded_at          timestamptz not null default now(),
  confirmed_by         uuid references public.users (id),
  confirmed_at         timestamptz,
  cancellation_reason  text,
  cancelled_by         uuid references public.users (id),
  cancelled_at         timestamptz,
  replaced_import_id   uuid references public.imports (id)
);

create index idx_imports_checksum on public.imports (checksum_sha256);
create index idx_imports_report_date on public.imports (report_date);

-- apenas uma versão ativa por data de relatório
create unique index uq_imports_active_per_date
  on public.imports (report_date)
  where status in ('ATIVO', 'COM_PENDENCIAS');

-- -------------------------------------------------------------
-- import_rows
-- -------------------------------------------------------------
create table public.import_rows (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid not null references public.imports (id) on delete cascade,
  row_number       integer not null,
  raw_data         jsonb not null,
  normalized_data  jsonb,
  client_id        uuid references public.clients (id),
  status           import_row_status not null,
  created_at       timestamptz not null default now()
);

create index idx_import_rows_import on public.import_rows (import_id);

-- -------------------------------------------------------------
-- client_snapshots — imutáveis após processamento
-- -------------------------------------------------------------
create table public.client_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  import_id                uuid not null references public.imports (id),
  client_id                uuid not null references public.clients (id),
  report_date              date not null,
  coverage_end_date        date not null,
  cumulative_volume           decimal(18,2) not null,
  cumulative_orders  bigint not null,
  last_purchase_date    date,
  days_without_purchase   integer,
  recency                  varchar,
  source_seller_text   varchar,
  source_row_number        integer,
  status                   snapshot_status not null default 'ACTIVE',
  created_at               timestamptz not null default now(),

  constraint uq_snapshot_import_client unique (import_id, client_id)
);

create index idx_snapshots_client_coverage
  on public.client_snapshots (client_id, coverage_end_date);

-- -------------------------------------------------------------
-- production_intervals
-- -------------------------------------------------------------
create table public.production_intervals (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references public.clients (id),
  previous_snapshot_id     uuid references public.client_snapshots (id),
  current_snapshot_id      uuid not null references public.client_snapshots (id),
  period_start             date not null,
  period_end               date not null,
  day_count                integer not null,
  volume_delta                decimal(18,2),
  order_delta        bigint,
  granularity              production_granularity not null,
  calculation_status       calculation_status not null,
  assigned_seller_id   uuid references public.sellers (id),
  calculated_at            timestamptz not null default now(),
  calculation_version      integer not null default 1
);

create index idx_production_client_period
  on public.production_intervals (client_id, period_end);
create index idx_production_seller
  on public.production_intervals (assigned_seller_id, period_end);
create index idx_production_status
  on public.production_intervals (calculation_status);

-- -------------------------------------------------------------
-- import_issues
-- -------------------------------------------------------------
create table public.import_issues (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid not null references public.imports (id),
  import_row_id  uuid references public.import_rows (id),
  client_id      uuid references public.clients (id),
  type           issue_type not null,
  severity       issue_severity not null,
  status         issue_status not null default 'OPEN',
  details        jsonb,
  resolution     jsonb,
  resolved_by    uuid references public.users (id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_issues_import on public.import_issues (import_id);
create index idx_issues_status on public.import_issues (status, severity);

-- -------------------------------------------------------------
-- campaigns
-- -------------------------------------------------------------
create table public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  name             varchar not null,
  description      text,
  start_date       date not null,
  end_date         date not null,
  primary_metric   campaign_metric not null default 'VOLUME',
  target_value     decimal(18,2),
  status           campaign_status not null default 'RASCUNHO',
  closing_version  integer not null default 0,
  closed_at        timestamptz,
  created_by       uuid references public.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint chk_campaign_period check (end_date >= start_date)
);

-- -------------------------------------------------------------
-- campaign_sellers
-- -------------------------------------------------------------
create table public.campaign_sellers (
  campaign_id        uuid not null references public.campaigns (id) on delete cascade,
  seller_id      uuid not null references public.sellers (id),
  individual_target  decimal(18,2),

  primary key (campaign_id, seller_id)
);

-- -------------------------------------------------------------
-- audit_logs — imutável
-- -------------------------------------------------------------
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users (id),
  action       varchar not null,
  entity_type  varchar not null,
  entity_id    uuid,
  before_data  jsonb,
  after_data   jsonb,
  reason       text,
  ip_address   varchar,
  created_at   timestamptz not null default now()
);

create index idx_audit_entity on public.audit_logs (entity_type, entity_id);
create index idx_audit_user on public.audit_logs (user_id, created_at);

-- -------------------------------------------------------------
-- Row Level Security
-- Habilitada em todas as tabelas desde já (deny-by-default).
-- As policies por papel serão criadas na migration de autenticação,
-- junto com a função que resolve o papel do usuário logado.
-- Até lá, o acesso ocorre apenas pelo backend (service_role).
-- -------------------------------------------------------------
alter table public.users enable row level security;
alter table public.sellers enable row level security;
alter table public.seller_aliases enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.client_snapshots enable row level security;
alter table public.production_intervals enable row level security;
alter table public.import_issues enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_sellers enable row level security;
alter table public.audit_logs enable row level security;
