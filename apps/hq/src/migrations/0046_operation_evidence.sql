-- An observation that cannot continue is not a platform failure. The original handle remains.
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_state_check;
ALTER TABLE hq_deploy_job DROP CONSTRAINT hq_deploy_job_check;
ALTER TABLE hq_deploy_job ADD CONSTRAINT hq_deploy_job_state_check CHECK (
  state IN ('queued', 'submitting', 'building', 'live', 'failed', 'refused', 'unresolved', 'skipped', 'superseded')
);
ALTER TABLE hq_deploy_job ADD CONSTRAINT hq_deploy_job_ended_check CHECK (
  (state IN ('live', 'failed', 'refused', 'unresolved', 'skipped', 'superseded')) = (ended_at IS NOT NULL)
);
ALTER TABLE hq_deploy_job ADD COLUMN evidence jsonb;
ALTER TABLE hq_deploy_job ADD COLUMN verified_version_id text;
ALTER TABLE hq_deploy_job ADD COLUMN steps jsonb NOT NULL DEFAULT '[]';
