-- HQ's own records: a person's sessions, and the structure of applications (ADR 0002). Every write
-- goes through the leader's fenced transaction (`leader.ts`).

-- A session HQ issued at its door: only the token's SHA-256 is kept.
CREATE TABLE hq_session (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  org_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- `seq` keeps the order things were made in.
CREATE TABLE hq_app (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A Zerops project of an application; a project belongs to one application at most.
CREATE TABLE hq_app_project (
  project_id text PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  app_id uuid NOT NULL REFERENCES hq_app (id),
  kind text NOT NULL CHECK (kind IN ('mate', 'stage', 'production')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one production per application.
CREATE UNIQUE INDEX hq_app_one_production ON hq_app_project (app_id) WHERE kind = 'production';

-- The Mate on a project of kind `mate`: its name and face.
CREATE TABLE hq_mate (
  project_id text PRIMARY KEY REFERENCES hq_app_project (project_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  face text NOT NULL
);
