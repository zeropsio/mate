-- Expand only: retain every legacy key, constraint, index and release snapshot.
-- Old Core can omit the new keys; new Core reconciles them before serving each acquired epoch.
ALTER TABLE hq_environment ADD COLUMN id text;
ALTER TABLE hq_environment ADD COLUMN target text NOT NULL DEFAULT 'zerops'
  CHECK (target = 'zerops');
UPDATE hq_environment SET id = project_id;
ALTER TABLE hq_environment ADD UNIQUE (id);
ALTER TABLE hq_environment ADD CHECK (id = project_id);
CREATE UNIQUE INDEX hq_environment_one_production ON hq_environment (app_id)
  WHERE tier = 'production';

ALTER TABLE hq_deploy_job ADD COLUMN environment_id text;
UPDATE hq_deploy_job SET environment_id = project_id;
ALTER TABLE hq_deploy_job ADD FOREIGN KEY (environment_id) REFERENCES hq_environment (id)
  ON DELETE CASCADE;
ALTER TABLE hq_deploy_job ADD CHECK (environment_id = project_id);
CREATE INDEX hq_deploy_job_environment_open ON hq_deploy_job (environment_id, id)
  WHERE ended_at IS NULL;
CREATE INDEX hq_deploy_job_environment_service ON hq_deploy_job (environment_id, service, id);

-- Rollouts outlive attachments and may name no environment: preserve NULLs and history, no FK.
ALTER TABLE hq_rollout ADD COLUMN environment_id text;
UPDATE hq_rollout SET environment_id = project_id;
ALTER TABLE hq_rollout ADD CHECK (environment_id IS NULL OR environment_id IS NOT DISTINCT FROM project_id);
ALTER TABLE hq_rollout ADD CHECK (NOT jsonb_path_exists(left_out,
  '$[*] ? (exists(@.environment_id) && @.environment_id != @.project_id)'));
UPDATE hq_rollout r SET left_out = (
  SELECT coalesce(jsonb_agg(entry || jsonb_build_object('environment_id', entry->'project_id')
    ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(r.left_out) WITH ORDINALITY AS entries(entry, ordinal)
);
