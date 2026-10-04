-- A release saved before production exists has a terminal recorded outcome, with no rollout.
ALTER TABLE hq_release ADD COLUMN snapshot boolean NOT NULL DEFAULT false;
