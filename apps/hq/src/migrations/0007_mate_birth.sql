-- A Mate's birth, written by the client that set it up: who asked for its stand-up, and when its
-- project was closed off, so that its runtimes may be imported.
ALTER TABLE hq_mate ADD COLUMN standup_requested_by text;
ALTER TABLE hq_mate ADD COLUMN closed_off_at timestamptz;
-- A Mate recorded before births were is closed off: its client set it up whole, as clients did then.
-- Left unset, the client's close-off gate would hold it from connecting for good.
UPDATE hq_mate SET closed_off_at = now();
