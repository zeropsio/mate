-- How a task's hand-offs to automated Mates went (`mateTasks.ts`): since when its Mates have turned
-- it down (`declined_since`, from the first refusal; the task fails once they have for 30 minutes).
ALTER TABLE hq_task ADD COLUMN declined_since timestamptz;
