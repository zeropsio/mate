-- A Mate's birth, written by the client that set it up (adr/0002: HQ holds what was a tag): who asked
-- for its stand-up (`mate:standup:<userId>`), and when its project was closed off, so that its
-- runtimes may be imported (`mate:closed-off`).
ALTER TABLE hq_mate ADD COLUMN standup_requested_by text;
ALTER TABLE hq_mate ADD COLUMN closed_off_at timestamptz;
