-- P7: medical assistants roster (dashboard staffing view).

create table medical_assistants (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- human-readable staff ID, e.g. MA-1042
  name text not null,
  specialization text not null,              -- e.g. Wound Care RN, Geriatric Care
  location text not null,                    -- city / area served
  status text not null default 'available'   -- available | busy | off
    check (status in ('available', 'busy', 'off')),
  availability text,                         -- human-readable window, e.g. "Until 6:00 PM"
  created_at timestamptz default now()
);

-- Realtime + anon read (dashboard shows availability flips live).
alter publication supabase_realtime add table medical_assistants;
alter table medical_assistants enable row level security;
create policy "anon read medical_assistants" on medical_assistants for select using (true);
