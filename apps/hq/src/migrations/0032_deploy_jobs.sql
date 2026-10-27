-- Deploys as explicit jobs (the deploy-jobs design, 2026-10-03): nothing deploys on a timer and
-- nothing is tried twice. Every deploy is a job an event asked for — a merge that moved main, a
-- release, a person's Run again or Add service, an environment added, a deploy key kept, an
-- import's hold — recorded in that event's own write, submitted in the request that made it, and
-- every job ends in exactly one terminal state, with when and why.
--
-- An event is a rollout: what asked, and against what. HQ plans it into its jobs once; a rollout
-- not yet planned is planned by whichever Core leads next. A merge's is one per commit.
CREATE TABLE hq_rollout (
  id bigserial PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  cause text NOT NULL CHECK (
    cause IN (
      'merge', 'release', 'run_again', 'add_service', 'env_added', 'key_kept', 'import', 'migrated'
    )
  ),
  -- merge: the repository and the head main moved to; release: its tag; env_added, key_kept,
  -- run_again, add_service: the environment; run_again, add_service: its service; run_again: its
  -- commit; who asked, where a person did.
  repo text,
  sha text,
  tag text,
  project_id text,
  service text,
  by text,
  -- What planning left out, in HQ's words: a tier it cannot read, a release that lists no service;
  -- and each service it asked for nothing, why — it runs the commit, or a job of it is under way:
  -- [{ "project_id", "service", "sha", "job", "reason" }].
  note text CHECK (length(note) <= 480),
  left_out jsonb NOT NULL DEFAULT '[]',
  planned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hq_rollout_unplanned ON hq_rollout (id) WHERE planned_at IS NULL;
-- The merge's own write and the main move git reports name the same rollout.
CREATE UNIQUE INDEX hq_rollout_merge ON hq_rollout (app_id, repo, sha) WHERE cause = 'merge';

-- A rollout's jobs, each in one environment: a `deploy` of one service at one commit, or a `delta`
-- (main D15, audit D2) importing the services a tier change added. queued → submitting → building
-- → live | failed | refused | skipped | superseded: `failed` is the build's own (final until a
-- person asks again, B37), `refused` what did not go through at its one try, `skipped` what HQ
-- chose not to submit, and why, `superseded` a newer job of the same service that came while this
-- one waited. One environment builds one job at a time; the rest wait, queued.
CREATE TABLE hq_deploy_job (
  id bigserial PRIMARY KEY,
  rollout_id bigint NOT NULL REFERENCES hq_rollout (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deploy', 'delta')),
  project_id text NOT NULL REFERENCES hq_environment (project_id) ON DELETE CASCADE,
  -- The hostname names it; the service's id says whose it is (audit N6), once HQ read it.
  service text,
  service_id text,
  repo text,
  sha text CHECK (sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  -- What its version is named by: `main`, or the release's tag; none where HQ no longer knows it.
  label text,
  -- A delta's: the services it imports, and its import's processes once Zerops answered it.
  services text[],
  processes text[],
  -- Its place among its rollout's jobs: the tier's priority (B19).
  ord integer NOT NULL DEFAULT 0,
  state text NOT NULL CHECK (
    state IN (
      'queued', 'submitting', 'building', 'live', 'failed', 'refused', 'skipped', 'superseded'
    )
  ),
  reason text CHECK (length(reason) <= 240),
  app_version_id text,
  process_id text,
  submitted_at timestamptz,
  superseded_by bigint REFERENCES hq_deploy_job (id) ON DELETE SET NULL,
  -- Who asked for it again (Run again, a release over a failed build); none while only HQ asked.
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK ((state IN ('live', 'failed', 'refused', 'skipped', 'superseded')) = (ended_at IS NOT NULL)),
  CHECK (kind = 'delta' OR (service IS NOT NULL AND repo IS NOT NULL AND sha IS NOT NULL))
);

CREATE INDEX hq_deploy_job_open ON hq_deploy_job (project_id, id) WHERE ended_at IS NULL;
CREATE INDEX hq_deploy_job_service ON hq_deploy_job (project_id, service, id);
CREATE INDEX hq_deploy_job_version ON hq_deploy_job (service_id, app_version_id)
  WHERE app_version_id IS NOT NULL;

-- Every record of before, as one rollout per application. A live record stays live, with the
-- version it runs where HQ kept it; a build's own failure stays final; a build HQ submitted is
-- followed again by its version and job (audit H6); a record waiting or refused by HQ ends refused,
-- for Run again — no timer asks it any more.
INSERT INTO hq_rollout (app_id, cause, note, planned_at)
SELECT DISTINCT e.app_id, 'migrated', 'Carried over from the deploy records before jobs.', now()
FROM hq_deploy d JOIN hq_environment e ON e.project_id = d.project_id;

INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, service_id, repo, sha, state,
  reason, app_version_id, process_id, submitted_at, requested_by, created_at, updated_at,
  ended_at)
SELECT r.id, 'deploy', d.project_id, d.service, d.service_id, d.repo, d.sha,
  CASE
    WHEN d.state = 'live' THEN 'live'
    WHEN d.state = 'failed' AND d.failure = 'job' THEN 'failed'
    WHEN d.state = 'deploying' AND d.app_version_id IS NOT NULL THEN
      CASE WHEN d.process_id IS NULL THEN 'submitting' ELSE 'building' END
    ELSE 'refused'
  END,
  CASE
    WHEN d.state = 'live' OR (d.state = 'failed' AND d.failure = 'job') THEN d.message
    WHEN d.state = 'deploying' AND d.app_version_id IS NOT NULL THEN NULL
    ELSE left(coalesce(d.message || ' — ', '') || 'Run again asks for it.', 240)
  END,
  d.app_version_id, d.process_id,
  CASE WHEN d.state = 'deploying' AND d.app_version_id IS NOT NULL THEN d.updated_at END,
  d.requested_by, d.created_at, d.updated_at,
  CASE
    WHEN d.state = 'deploying' AND d.app_version_id IS NOT NULL THEN NULL
    ELSE d.updated_at
  END
FROM hq_deploy d
JOIN hq_environment e ON e.project_id = d.project_id
JOIN hq_rollout r ON r.app_id = e.app_id AND r.cause = 'migrated'
ORDER BY d.created_at, d.service;

DROP TABLE hq_deploy;
