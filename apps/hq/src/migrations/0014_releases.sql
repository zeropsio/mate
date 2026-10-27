-- An application's releases to production (SPEC §3.2d): each an annotated tag on its recipe
-- repository's `main`, recorded as Core made it — approved, as Core tags only what it allowed — or,
-- from main's history, as its broker judged it, a refusal with its reason. A rollback names the
-- release it goes back to. Every write goes through the leader's fenced transaction.
CREATE TABLE hq_release (
  app_id uuid NOT NULL REFERENCES hq_app (id),
  tag text NOT NULL CHECK (tag ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
  sha text NOT NULL CHECK (sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  entries jsonb NOT NULL,
  released_by text NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK (state IN ('approved', 'refused')),
  reason text,
  rollback_of text,
  PRIMARY KEY (app_id, tag),
  CHECK ((state = 'refused') = (reason IS NOT NULL))
);

-- A release made is logged with what happened to the application's repositories.
ALTER TABLE hq_git_event DROP CONSTRAINT hq_git_event_kind_check;
ALTER TABLE hq_git_event ADD CONSTRAINT hq_git_event_kind_check
  CHECK (kind IN ('pushed', 'opened', 'main_moved', 'merged', 'closed', 'commented', 'released'));
