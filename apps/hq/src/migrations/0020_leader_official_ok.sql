-- The newest ok the leading Core holds of whether it is the official HQ (`official.ts`), and the
-- project it was read for. The next Core takes it as its own until Zerops answers it, so a
-- takeover never waits on Zerops (F18). None before a leader recorded one.
ALTER TABLE hq_leader ADD COLUMN official_ok_at timestamptz, ADD COLUMN official_ok_project text;
