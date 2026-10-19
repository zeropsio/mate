-- The head of a task's change when it last ended done: an ending after a follow-up tells where
-- the task came from of the new commit its change took this time (`TaskAnswer.pushed`).
ALTER TABLE hq_task ADD COLUMN done_head text;
