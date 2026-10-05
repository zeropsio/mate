-- Whether a job's `uploaded_at` is HQ's record of its upload (review #3 on 0039): true for every job
-- made from here on, so an upload that never answered — no `uploaded_at` — asked for no build.
-- False for the jobs that were already there: their Core recorded no uploads, so their missing
-- `uploaded_at` says nothing, and their version is followed as it was then.
ALTER TABLE hq_deploy_job ADD COLUMN upload_recorded boolean NOT NULL DEFAULT false;
ALTER TABLE hq_deploy_job ALTER COLUMN upload_recorded SET DEFAULT true;
