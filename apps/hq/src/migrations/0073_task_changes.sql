-- A change an automated Mate opens on a task is that task's (`task_id`): each task delivers to its own
-- change, so a Mate holds several open at once, one per task in a repository. A change opened on no
-- task (a person's own Mate) stays the Mate's one open change in the repository.
ALTER TABLE hq_change ADD COLUMN task_id uuid REFERENCES hq_task (id) ON DELETE SET NULL;
UPDATE hq_change c SET task_id = t.id FROM hq_task t
  WHERE t.app_id = c.app_id AND t.change_repo = c.repo AND t.change_number = c.number;

DROP INDEX hq_change_one_open;
CREATE UNIQUE INDEX hq_change_one_open ON hq_change (app_id, repo, mate_project_id)
  WHERE state = 'open' AND task_id IS NULL;
CREATE UNIQUE INDEX hq_change_task_open ON hq_change (app_id, repo, task_id)
  WHERE state = 'open' AND task_id IS NOT NULL;

-- When HQ last told the Mate a follow-up on its task while the task was done (its change waiting for
-- review): the Mate owes it until it is back on it, so it takes no new task meanwhile.
ALTER TABLE hq_task ADD COLUMN follow_up_at timestamptz;
