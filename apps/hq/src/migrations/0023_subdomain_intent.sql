-- Where HQ turns a service's subdomain on (audit R1, D6): only on the first deploy of a service
-- created for HQ to deploy, as recorded here, and never on a catch-up. A row with no `service` is a
-- project the person's client created for HQ (its attach said so), turned into one row per service
-- by the first deploy pass that reads its tier; a row with one is a service of it still to be
-- deployed first, or one HQ's recipe delta imported. A row goes once its service's first deploy
-- is live, and with its environment.
CREATE TABLE hq_subdomain_intent (
  project_id text NOT NULL REFERENCES hq_environment (project_id) ON DELETE CASCADE,
  service text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hq_subdomain_intent_key ON hq_subdomain_intent (project_id, COALESCE(service, ''));
