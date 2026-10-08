CREATE TABLE hq_auto_update_policy (
  org_id text PRIMARY KEY,
  enabled boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL
);
