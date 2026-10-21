-- A change is a branch: the name under `refs/heads/` its Mate pushes to, chosen when the change is
-- opened (`mate/<mate_project_id>/<number>` where none is named, as every change before this had).
-- A branch is one open change's at a time; a change no longer open frees it.
ALTER TABLE hq_change ADD COLUMN branch text;
UPDATE hq_change SET branch = 'mate/' || mate_project_id || '/' || number;
ALTER TABLE hq_change ALTER COLUMN branch SET NOT NULL;
CREATE UNIQUE INDEX hq_change_open_branch ON hq_change (app_id, repo, branch) WHERE state = 'open';
-- A push asks which change its branch was last: one read per pushed ref.
CREATE INDEX hq_change_branch ON hq_change (app_id, repo, branch, number DESC);
