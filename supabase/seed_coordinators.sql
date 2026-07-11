-- P6 on-call coordinators. EDIT the phone numbers to real cells (E.164) before
-- running. Exactly one should be active=true — that's who gets the escalation SMS.

insert into coordinators (name, phone, active) values
  ('Alex Rivera', '+1XXXXXXXXXX', true),   -- active on-call (put YOUR cell here)
  ('Jordan Kim',  '+1YYYYYYYYYY', false);
