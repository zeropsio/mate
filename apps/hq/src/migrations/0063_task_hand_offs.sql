-- How a task's hand-offs to automated Mates went (`mateTasks.ts`):
-- - `last_mate_project_id`, the Mate it was last handed to: given back while that Mate's link was
--   down, its late word is still taken while the task waits for no other Mate;
-- - `declined_since`, since when its Mates have turned it down, from the first refusal: the task
--   fails once they have for 30 minutes.
ALTER TABLE hq_task ADD COLUMN last_mate_project_id text;
ALTER TABLE hq_task ADD COLUMN declined_since timestamptz;
