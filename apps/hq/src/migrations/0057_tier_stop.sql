-- A production service HQ stopped because its release's tier no longer declared it: the only
-- service a later release may start again; never one a person stopped.
CREATE TABLE hq_tier_stop (
  environment_id text NOT NULL REFERENCES hq_environment (id) ON DELETE CASCADE,
  service_id text NOT NULL,
  PRIMARY KEY (environment_id, service_id)
);
