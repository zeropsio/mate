-- Why a service stands stopped, for the person who may delete it: its hostname, and the release a
-- rollback went back to — none where the tier itself dropped it. A stage's tier change stops too.
ALTER TABLE hq_tier_stop
  ADD COLUMN service text NOT NULL DEFAULT '',
  ADD COLUMN rollback_to text;
