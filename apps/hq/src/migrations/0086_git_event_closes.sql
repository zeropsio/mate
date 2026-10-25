-- Whether a closed change's own Mate closed it (`closed_by_mate`, `changes.ts`; the pull-request
-- sweep's `closed_by_mate`) is read from the log's close of it, with every change read: found by
-- the change, never by scanning the log.
CREATE INDEX hq_git_event_closes ON hq_git_event (app_id, repo, number) WHERE kind = 'closed';
