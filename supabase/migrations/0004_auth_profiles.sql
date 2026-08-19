-- Auth profiles — role-based access for the pilot (admin | analyst).
--
-- Identity comes from Supabase Auth; a profiles row keyed to auth.users grants
-- the app role. 'admin' saves rulebook versions, records macro overrides,
-- deletes deals/decisions, and manages users; 'analyst' does everything else
-- (intake, extraction, preview, decide, reads). A signed-in user with NO
-- profiles row has no access — except bootstrap: the first authenticated
-- request from the user whose email matches BOOTSTRAP_ADMIN_EMAIL auto-creates
-- their admin profile (netlify/functions/lib/auth.ts), so a fresh environment
-- gets its first admin without a manual insert. There is no self-signup;
-- admins create users via the users API.
--
-- All of this activates only where Supabase is configured: the public demo
-- site (db-null) keeps no login and no enforcement, exactly as before.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null check (role in ('admin','analyst')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS on with zero policies: deny-all for anon/authenticated — service key
-- only, the same trust boundary as every other table (the SPA never talks to
-- Supabase directly; all reads/writes go through the Netlify functions).
alter table profiles enable row level security;

-- Attribution: stamped by the API when a verified identity is present, null
-- otherwise (db-null demo mode and pre-auth history).
-- threshold_configs.author already exists (0001).
alter table gate_decisions add column if not exists decided_by_email text;
alter table macro_snapshots add column if not exists author_email text;
