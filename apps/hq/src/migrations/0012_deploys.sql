-- An environment's deploys (SPEC §3.2b, main B26/B27): one per service and commit HQ wanted there,
-- and where it stands — waiting, being deployed, live, failed — with the platform's version and
-- job it is read by. A build's own failure (`job`) is final until a person asks again (B37); HQ's
-- own refusal (`refused`) is asked again by the next pass (B38).
CREATE TABLE hq_deploy (
  project_id text NOT NULL REFERENCES hq_environment (project_id) ON DELETE CASCADE,
  service text NOT NULL,
  sha text NOT NULL CHECK (sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  repo text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'deploying', 'live', 'failed')),
  failure text CHECK (failure IN ('job', 'refused')),
  message text CHECK (length(message) <= 240),
  app_version_id text,
  process_id text,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, service, sha),
  CHECK ((state = 'failed') = (failure IS NOT NULL))
);
