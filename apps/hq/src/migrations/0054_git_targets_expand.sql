-- After 0054, never restore an HQ app version older than e28fc0b573.
-- Deploy only above the slice-1 identity-writer floor in every active/restartable Core.
-- Keep project bindings and all legacy Zerops storage; Git has no Zerops project.
ALTER TABLE hq_deploy_token DROP CONSTRAINT hq_deploy_token_project_id_fkey;
ALTER TABLE hq_subdomain_intent DROP CONSTRAINT hq_subdomain_intent_project_id_fkey;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_project_id_fkey;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_environment_id_fkey;
ALTER TABLE hq_environment DROP CONSTRAINT hq_environment_pkey;
ALTER TABLE hq_environment DROP CONSTRAINT hq_environment_id_key;
ALTER TABLE hq_environment DROP CONSTRAINT hq_environment_check;
ALTER TABLE hq_environment DROP CONSTRAINT hq_environment_target_check;
ALTER TABLE hq_environment ALTER COLUMN id SET NOT NULL;
ALTER TABLE hq_environment ADD PRIMARY KEY (id);
ALTER TABLE hq_environment ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE hq_environment ADD UNIQUE (project_id);
ALTER TABLE hq_environment ADD FOREIGN KEY (app_id) REFERENCES hq_app(id) ON DELETE CASCADE;
ALTER TABLE hq_environment ADD CHECK (target IN ('zerops', 'git'));
ALTER TABLE hq_environment ADD CHECK ((target = 'zerops') = (project_id IS NOT NULL));
ALTER TABLE hq_environment ADD COLUMN branch text;
ALTER TABLE hq_environment ADD COLUMN delivery text CHECK (delivery IN ('direct'));
ALTER TABLE hq_environment ADD CHECK ((target = 'git') = (branch IS NOT NULL));
ALTER TABLE hq_environment ADD CHECK (branch IS NULL OR length(branch) > 0);
ALTER TABLE hq_environment ADD CHECK ((target = 'git') = (delivery IS NOT NULL));
CREATE UNIQUE INDEX hq_environment_git_branch ON hq_environment(app_id, branch) WHERE target = 'git';

ALTER TABLE hq_deploy_token ADD FOREIGN KEY (project_id) REFERENCES hq_environment(project_id) ON DELETE CASCADE;
ALTER TABLE hq_subdomain_intent ADD FOREIGN KEY (project_id) REFERENCES hq_environment(project_id) ON DELETE CASCADE;
ALTER TABLE hq_deploy_job ADD FOREIGN KEY (project_id) REFERENCES hq_environment(project_id) ON DELETE CASCADE;
ALTER TABLE hq_deploy_job ADD FOREIGN KEY (environment_id) REFERENCES hq_environment(id) ON DELETE CASCADE;
ALTER TABLE hq_deploy_job ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_check;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_check1;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_kind_check;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_state_check;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_ended_check;
ALTER TABLE hq_deploy_job ADD CHECK (kind IN ('deploy', 'delta', 'push'));
ALTER TABLE hq_deploy_job ADD CHECK (
  (kind = 'push' AND environment_id IS NOT NULL AND project_id IS NULL AND service IS NULL AND repo IS NOT NULL AND sha IS NOT NULL)
  OR (kind <> 'push' AND project_id IS NOT NULL AND (kind = 'delta' OR (service IS NOT NULL AND repo IS NOT NULL AND sha IS NOT NULL)))
);
ALTER TABLE hq_deploy_job ADD CONSTRAINT hq_deploy_job_state_check CHECK (
  state IN ('queued', 'submitting', 'building', 'live', 'pushed', 'failed', 'refused', 'unresolved', 'skipped', 'superseded')
);
ALTER TABLE hq_deploy_job ADD CONSTRAINT hq_deploy_job_ended_check CHECK (
  (state IN ('live', 'pushed', 'failed', 'refused', 'unresolved', 'skipped', 'superseded')) = (ended_at IS NOT NULL)
);
ALTER TABLE hq_deploy_job ADD CHECK (state <> 'pushed' OR kind = 'push');

-- Old release/rollout attachment provenance remains unknown, never manufactured.
ALTER TABLE hq_rollout DROP CONSTRAINT hq_rollout_check;
ALTER TABLE hq_rollout DROP CONSTRAINT hq_rollout_left_out_check;
ALTER TABLE hq_rollout ADD COLUMN environment_created_at timestamptz;
ALTER TABLE hq_release ADD COLUMN target text NOT NULL DEFAULT 'zerops' CHECK (target IN ('zerops', 'git'));
ALTER TABLE hq_release ADD COLUMN environment_id text;
ALTER TABLE hq_release ADD COLUMN environment_created_at timestamptz;

CREATE TABLE hq_repo_remote (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  url text NOT NULL CHECK (url ~ '^https://'),
  host text NOT NULL,
  url_key text NOT NULL UNIQUE,
  host_repo_id text,
  sealed bytea,
  key_id text,
  kept_by text,
  kept_at timestamptz,
  invalid_since timestamptz,
  expires_at timestamptz,
  PRIMARY KEY (app_id, repo),
  FOREIGN KEY (app_id, repo) REFERENCES hq_repo(app_id, name) ON DELETE CASCADE,
  CHECK ((sealed IS NULL) = (key_id IS NULL)),
  CHECK (sealed IS NULL OR (kept_by IS NOT NULL AND kept_at IS NOT NULL))
);
CREATE UNIQUE INDEX hq_repo_remote_host_id ON hq_repo_remote(host, host_repo_id) WHERE host_repo_id IS NOT NULL;
