-- P7 medical assistants roster — sample staffing data, tuned to the demo's
-- NJ/NYC service area (see supabase/seed.sql). Safe to re-run: on conflict noop.

insert into medical_assistants (code, name, specialization, location, status, availability) values
  ('MA-1042', 'Maria Alvarez',  'Wound Care RN',        'Springfield, NJ (07081)',  'available', 'Until 6:00 PM'),
  ('MA-1067', 'David Chen',      'Geriatric Care',       'Summit, NJ (07901)',       'available', 'Until 8:00 PM'),
  ('MA-1085', 'Priya Nair',      'Physical Therapy',     'Millburn, NJ (07041)',     'busy',      'Free after 3:30 PM'),
  ('MA-1091', 'James Okafor',    'Cardiac / CHF',        'West Orange, NJ (07052)',  'available', 'Until 5:00 PM'),
  ('MA-1103', 'Sarah Kim',       'Speech Therapy',       'Chelsea, NY (10001)',      'off',       'Back tomorrow 9 AM'),
  ('MA-1118', 'Andre Thompson',  'Home Health Aide',     'Brooklyn Heights (11201)', 'available', 'Until 7:30 PM'),
  ('MA-1124', 'Elena Rossi',     'Diabetes Management',  'Westfield, NJ (07090)',    'busy',      'Free after 4:15 PM'),
  ('MA-1130', 'Marcus Lee',      'Occupational Therapy', 'Short Hills, NJ (07078)',  'available', 'Until 6:45 PM')
on conflict (code) do nothing;
