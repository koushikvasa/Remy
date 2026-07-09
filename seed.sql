-- Remy seed data — tuned to the two demo scripts in REMY_SPEC.md §11
-- IMPORTANT: replace +1XXXXXXXXXX with the actual phone you will demo from.

insert into referral_sources (phone, org_name, contact_name, org_type) values
  ('+1XXXXXXXXXX', 'Mercy General Hospital', 'Sarah Chen', 'hospital'),
  ('+12125550142', 'St. Vincent Medical Center', 'James Okafor', 'hospital'),
  ('+19735550188', 'Overlook Rehab & Nursing', 'Priya Nair', 'snf');

insert into service_areas (zip, county) values
  ('07081','Union'),('07088','Union'),('07090','Union'),('07092','Union'),
  ('07901','Union'),('07902','Union'),('07039','Essex'),('07041','Essex'),
  ('07052','Essex'),('07078','Essex'),('10001','New York'),('10011','New York'),
  ('10014','New York'),('11201','Kings'),('11215','Kings');
-- NOTE: 11550 deliberately NOT covered (escalation demo).

insert into payers (name, aliases, accepted, notes) values
  ('Medicare', '{"traditional medicare","medicare part a","medicare a and b"}', true, null),
  ('Aetna Medicare Advantage', '{"aetna","aetna ma"}', true, null),
  ('Humana Medicare Advantage', '{"humana","humana ma","humana gold plus"}', true, null),
  ('UnitedHealthcare Medicare Advantage', '{"united","uhc","unitedhealthcare","united healthcare"}', false, 'Contract lapsed — renegotiating'),
  ('Medicaid NJ', '{"medicaid","nj familycare"}', true, 'Recertification pending');

insert into capacity (discipline, open_slots, week_of) values
  ('RN', 4, current_date),
  ('PT', 3, current_date),
  ('OT', 2, current_date),
  ('ST', 0, current_date),   -- zero: speech-therapy referral triggers escalation
  ('HHA', 6, current_date),
  ('MSW', 1, current_date);
