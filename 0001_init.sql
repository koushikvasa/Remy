-- Remy: initial schema
create extension if not exists "pgcrypto";

create table referral_sources (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,              -- E.164, e.g. +19175551234
  org_name text not null,
  contact_name text,
  org_type text default 'hospital',        -- hospital | snf | physician | other
  created_at timestamptz default now()
);

create table service_areas (
  zip text primary key,
  county text,
  active boolean default true
);

create table payers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] default '{}',
  accepted boolean not null default true,
  notes text
);

create table capacity (
  id uuid primary key default gen_random_uuid(),
  discipline text not null check (discipline in ('RN','PT','OT','ST','HHA','MSW')),
  open_slots int not null default 0,
  week_of date not null default current_date,
  unique (discipline, week_of)
);

create table runs (
  run_id uuid primary key default gen_random_uuid(),
  caller_phone text,
  source_id uuid references referral_sources(id),
  status text not null default 'active'    -- active | completed | failed | escalated
    check (status in ('active','completed','failed','escalated')),
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(run_id),
  source_id uuid references referral_sources(id),
  patient_first_initial text,
  patient_age int,
  diagnosis_summary text,
  discipline_needed text check (discipline_needed in ('RN','PT','OT','ST','HHA','MSW')),
  payer_raw text,
  payer_matched_id uuid references payers(id),
  zip text,
  requested_start text,
  decision text check (decision in ('accepted','escalated','declined')),
  reason_code text,
  transcript_summary text,
  callback_phone text,
  created_at timestamptz default now()
);

create table run_events (
  id bigint generated always as identity primary key,
  run_id uuid references runs(run_id),
  seq int not null,
  stage text,                               -- GREETING|COLLECTING|READBACK|DECIDING|CLOSING
  sub_agent text,                           -- extractor|fitchecker|decider|responder|system
  tool_name text,
  latency_ms int,
  confidence numeric,
  payload jsonb,                            -- REDACTED. No PHI.
  created_at timestamptz default now()
);
create index run_events_run_idx on run_events(run_id, seq);

-- Realtime for the dashboard
alter publication supabase_realtime add table run_events, referrals, runs;

-- Hackathon RLS posture: agent uses service role (bypasses RLS).
-- Dashboard reads via anon: allow read-only.
alter table run_events enable row level security;
alter table referrals enable row level security;
alter table runs enable row level security;
create policy "anon read run_events" on run_events for select using (true);
create policy "anon read referrals" on referrals for select using (true);
create policy "anon read runs" on runs for select using (true);
