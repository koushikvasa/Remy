-- P6: human-in-the-loop escalation.

create table coordinators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,              -- E.164, e.g. +16625478393
  active boolean not null default true,    -- the on-call coordinator
  created_at timestamptz default now()
);

-- Referral assignment. decision stays 'escalated'; an assigned_to marks it taken.
-- callout_at is the idempotency guard: set when the outbound call is placed.
alter table referrals add column assigned_to uuid references coordinators(id);
alter table referrals add column assigned_at timestamptz;
alter table referrals add column callout_at timestamptz;

-- Realtime + anon read (dashboard shows assignment flips live).
alter publication supabase_realtime add table coordinators;
alter table coordinators enable row level security;
create policy "anon read coordinators" on coordinators for select using (true);
