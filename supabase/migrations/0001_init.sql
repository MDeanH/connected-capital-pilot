-- Deal Intake / Gate 1 — initial schema
-- All decision-relevant tables are append-only: history is never rewritten,
-- so any past verdict can be replayed from (inputs, config version, macro snapshot).

create table deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_class text not null,
  location text,
  sponsor text,
  status text not null default 'draft',
  fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deal_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  kind text not null check (kind in ('om_pdf', 'proforma_xlsx')),
  storage_path text not null,
  filename text,
  bytes bigint,
  sha256 text,
  uploaded_at timestamptz not null default now()
);

create table extractions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id),
  status text not null default 'pending' check (status in ('pending','running','done','error')),
  model text,
  input_docs jsonb,
  fields jsonb,
  discrepancies jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table threshold_configs (
  version int primary key,
  created_at timestamptz not null default now(),
  author text,
  note text,
  config jsonb not null
);

create table macro_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_of date not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  signals jsonb not null,
  regime text not null,
  pending_regime text,
  degraded boolean not null default false,
  postures jsonb not null,
  hurdle jsonb,
  config_version int references threshold_configs(version),
  note text,
  created_at timestamptz not null default now()
);

create table gate_decisions (
  id uuid primary key default gen_random_uuid(),
  -- nullable: a decision can be recorded before a deal is formally saved
  deal_id uuid references deals(id),
  threshold_config_version int not null references threshold_configs(version),
  macro_snapshot_id uuid references macro_snapshots(id),
  inputs jsonb not null,
  overrides jsonb not null default '[]',
  baseline_result jsonb not null,
  baseline_verdict text not null,
  result jsonb not null,
  verdict text not null check (verdict in ('PASS','CONDITIONAL','FAIL','REVIEW')),
  created_at timestamptz not null default now()
);

-- RLS on with zero policies: deny-all for anon/authenticated.
-- The SPA never talks to Supabase; only Netlify functions hold the service key.
alter table deals enable row level security;
alter table deal_documents enable row level security;
alter table extractions enable row level security;
alter table threshold_configs enable row level security;
alter table macro_snapshots enable row level security;
alter table gate_decisions enable row level security;
