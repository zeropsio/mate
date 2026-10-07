-- A person's original request survives their client and removal of the target's platform roles.
CREATE TABLE hq_lifecycle_receipt (
  request_id text PRIMARY KEY,
  user_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  record jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
CREATE INDEX hq_lifecycle_person ON hq_lifecycle_receipt (user_id, seq);
