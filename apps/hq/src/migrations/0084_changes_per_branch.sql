-- A person's own Mate holds an open change per branch it names (`hq_change_open_branch` keeps a
-- branch one open change's). An opening that names no branch is the Mate's one default change in
-- the repository, on `mate/<mate_project_id>/<number>`, which released zcp and the recipe writer read
-- as "the Mate's change". A change handed over keeps its branch, so it is no default of its new Mate.
-- A task's change stays one per task (`hq_change_task_open`).
DROP INDEX hq_change_one_open;
CREATE UNIQUE INDEX hq_change_one_default ON hq_change (app_id, repo, mate_project_id)
  WHERE state = 'open' AND task_id IS NULL
    AND branch = 'mate/' || mate_project_id || '/' || number::text;
-- A Mate's open changes in a repository, counted against how many it may open at once.
CREATE INDEX hq_change_mate_open ON hq_change (app_id, repo, mate_project_id) WHERE state = 'open';
