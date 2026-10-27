-- Where each application's releases and its repositories' `main` last moved (`gitEvents.ts`
-- `releaseRevisions`), read with every structure view: the log's moves alone, by application.
CREATE INDEX hq_git_event_release_moves ON hq_git_event (app_id, seq)
  WHERE kind IN ('main_moved', 'merged', 'released');
