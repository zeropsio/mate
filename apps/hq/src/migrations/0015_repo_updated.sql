-- When a repository's `main` last moved as HQ recorded it, and before it ever has, the repository's
-- making: what the Git page reads beside `main_head`. A repository made before is given its last
-- recorded move, from the log.
ALTER TABLE hq_repo ADD COLUMN updated_at timestamptz;

UPDATE hq_repo SET updated_at = COALESCE(
  (SELECT max(at) FROM hq_git_event
   WHERE kind = 'main_moved' AND app_id = hq_repo.app_id AND repo = hq_repo.name),
  created_at
);

ALTER TABLE hq_repo ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE hq_repo ALTER COLUMN updated_at SET DEFAULT now();
