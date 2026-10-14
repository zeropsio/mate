-- Safe person intents and owner receipts; no candidate token or credential seal belongs here.
CREATE TABLE hq_git_target_receipt (
  request_id text PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id text NOT NULL,
  app_id uuid NOT NULL,
  intent jsonb NOT NULL,
  receipt jsonb NOT NULL
);
