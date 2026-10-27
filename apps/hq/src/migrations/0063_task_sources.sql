-- Tasks from every source (`@t3tools/contracts` `MateTaskSource`): a GitHub issue, a Slack thread, a
-- Discord thread, a signed webhook's call, a schedule's run (`taskSources.ts`). `source` is the
-- task's source as its card draws it; `source_key` the work item it is about, one live task per
-- application and key (`github:acme/tea-shop#12`); `requested_by` the Zerops user its source's gate
-- mapped, where it maps one; `status_ref` where its one status line lives on the source (a GitHub
-- comment's id, a Slack message's ts, a Discord message's id). `repo`/`number` stay a GitHub
-- issue's alone. A task may wait for a person's answer (`waiting`, since `waiting_since`, asking
-- `question`, reminded once at `reminded_at`) and be stopped by people (`stop_reason`, asked at
-- `stop_requested_at`, ended `stopped` once its Mate says so — heard at `stop_heard_at`; until then
-- a Mate it was handed to is told to stop on each link). `told_position` is the place in its
-- application's queue its status line last said.
ALTER TABLE hq_task
  ADD COLUMN source_kind text NOT NULL DEFAULT 'github-issue',
  ADD COLUMN source jsonb,
  ADD COLUMN source_key text,
  ADD COLUMN requested_by text,
  ADD COLUMN status_ref text,
  ADD COLUMN waiting_since timestamptz,
  ADD COLUMN question text,
  ADD COLUMN reminded_at timestamptz,
  ADD COLUMN stop_reason text,
  ADD COLUMN stop_requested_at timestamptz,
  ADD COLUMN stop_heard_at timestamptz,
  ADD COLUMN told_position integer;
UPDATE hq_task SET
  source = jsonb_build_object('kind', 'github-issue', 'repo', repo, 'number', number, 'url', url,
    'title', title, 'author', author),
  source_key = 'github:' || repo || '#' || number::text;
ALTER TABLE hq_task
  ALTER COLUMN source_kind DROP DEFAULT,
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source_key SET NOT NULL,
  ALTER COLUMN repo DROP NOT NULL,
  ALTER COLUMN number DROP NOT NULL,
  ALTER COLUMN url DROP NOT NULL,
  ADD CONSTRAINT hq_task_source_kind CHECK (source_kind IN ('github-issue', 'slack-thread', 'discord-thread', 'webhook', 'schedule')),
  ADD CONSTRAINT hq_task_issue CHECK ((source_kind = 'github-issue') = (repo IS NOT NULL AND number IS NOT NULL)),
  ADD CONSTRAINT hq_task_source_key CHECK (length(source_key) BETWEEN 1 AND 500);

ALTER TABLE hq_task DROP CONSTRAINT hq_task_state_check;
ALTER TABLE hq_task ADD CONSTRAINT hq_task_state_check CHECK (state IN
  ('queued', 'assigned', 'working', 'waiting', 'done', 'failed', 'dropped', 'stopped'));
ALTER TABLE hq_task DROP CONSTRAINT hq_task_check;
ALTER TABLE hq_task ADD CONSTRAINT hq_task_check CHECK (
  (state IN ('assigned', 'working', 'waiting')) = (mate_project_id IS NOT NULL AND assigned_at IS NOT NULL)
  OR state IN ('done', 'failed', 'stopped'));

DROP INDEX hq_task_live_issue;
CREATE UNIQUE INDEX hq_task_live_source ON hq_task (app_id, source_key)
  WHERE state IN ('queued', 'assigned', 'working', 'waiting');
CREATE INDEX hq_task_live_key ON hq_task (source_key)
  WHERE state IN ('queued', 'assigned', 'working', 'waiting');
DROP INDEX hq_task_live_mate;
CREATE UNIQUE INDEX hq_task_live_mate ON hq_task (mate_project_id)
  WHERE state IN ('assigned', 'working', 'waiting');
CREATE INDEX hq_task_change ON hq_task (app_id, change_repo, change_number)
  WHERE change_number IS NOT NULL;

-- What was said about a task after it came in (`MateTaskMessage`): kept until its Mate takes it,
-- then told on each of its links (the Mate hears each id once).
CREATE TABLE hq_task_message (
  task_id uuid NOT NULL REFERENCES hq_task (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 300),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  source text NOT NULL CHECK (source IN ('comment', 'reply', 'review', 'edit')),
  author text,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, id)
);

-- A public repository's issues are taken only where its intake says so: anyone may open one.
ALTER TABLE hq_intake ADD COLUMN public boolean NOT NULL DEFAULT false;

-- The organization's limits on each task (`HqTaskLimitsView`): one row, absent for the defaults.
CREATE TABLE hq_task_limits (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  cost_usd double precision CHECK (cost_usd > 0),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

-- An application's signed webhooks (`HqWebhookView`): a call on `/api/intake/webhook/<public_id>`,
-- signed with the secret sealed here (`deployKeys.ts` `sealSecret`), becomes a task.
CREATE TABLE hq_webhook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  public_id text NOT NULL UNIQUE,
  sealed bytea NOT NULL,
  key_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hq_webhook_app ON hq_webhook (app_id, seq);

-- An application's schedules (`HqScheduleView`): its brief becomes a task each time it is due
-- (`next_at`, computed in its time zone from `rule`, `HqScheduleRule`).
CREATE TABLE hq_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  brief text NOT NULL CHECK (length(brief) BETWEEN 1 AND 16000),
  rule jsonb NOT NULL,
  next_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hq_schedule_app ON hq_schedule (app_id, seq);
CREATE INDEX hq_schedule_due ON hq_schedule (next_at) WHERE next_at IS NOT NULL;
