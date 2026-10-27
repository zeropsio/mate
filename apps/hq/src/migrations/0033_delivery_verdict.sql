-- Empty deliveries are explicit verdicts, without allocating a change.
ALTER TABLE hq_git_event DROP CONSTRAINT hq_git_event_kind_check;
ALTER TABLE hq_git_event ADD CONSTRAINT hq_git_event_kind_check
  CHECK (kind IN ('pushed', 'opened', 'main_moved', 'merged', 'closed', 'commented', 'released', 'delivery_empty'));
