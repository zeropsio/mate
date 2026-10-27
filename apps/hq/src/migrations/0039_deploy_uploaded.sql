-- When HQ's upload of a deploy's archive answered (B9): from then on HQ asks for its build, and a
-- version still waiting for its archive is measured from it, never from before the upload. None
-- where the upload went unanswered — HQ asked for no build, and its version waits for good.
ALTER TABLE hq_deploy_job ADD COLUMN uploaded_at timestamptz;
