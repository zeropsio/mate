-- The end a reply after a task ended was answered for (`TaskIntake.answerEnded`): its `ended_at`
-- then. A second reply to the same end gets nothing; a task woken again ends anew (`ended_at`
-- moves), and a reply after that end is answered again.
ALTER TABLE hq_task ADD COLUMN end_answered_at timestamptz;
