-- The organization's Slack app (`slack.ts`): one per HQ. Slack sends its events to
-- `/api/intake/slack/<public_id>`, the address the app's manifest names: made at the first look and
-- kept, so an app made from the manifest goes on working across connections. Connected, it holds
-- the workspace (`team_id`, `team_name`), the bot's own user (`bot_user_id`, whose words HQ never
-- takes as an ask) and the bot token and signing secret, both sealed under HQ's key
-- (`deployKeys.ts`, `key_id`); none of them while it is not connected.
CREATE TABLE hq_slack (
  one boolean PRIMARY KEY DEFAULT true CHECK (one),
  public_id text NOT NULL UNIQUE,
  team_id text,
  team_name text,
  bot_user_id text,
  token_sealed bytea,
  secret_sealed bytea,
  key_id text,
  connected_by text,
  connected_at timestamptz,
  CHECK (
    (team_id IS NULL) = (team_name IS NULL)
    AND (team_id IS NULL) = (bot_user_id IS NULL)
    AND (team_id IS NULL) = (token_sealed IS NULL)
    AND (team_id IS NULL) = (secret_sealed IS NULL)
    AND (team_id IS NULL) = (key_id IS NULL)
  )
);

-- The channel an application takes tasks from: one per application, one application per channel;
-- `channel_name` as Slack named it when it was mapped, without `#`.
CREATE TABLE hq_slack_channel (
  app_id uuid PRIMARY KEY REFERENCES hq_app (id) ON DELETE CASCADE,
  channel_id text NOT NULL UNIQUE,
  channel_name text NOT NULL,
  mapped_by text NOT NULL,
  mapped_at timestamptz NOT NULL DEFAULT now()
);

-- A thread HQ took a task from (`source_key`, `slack:<team>/<channel>/<thread ts>`): the message
-- that asked (`ask_ts`, where the 👀 goes) and who asked (`asker`, the Slack user a question is put
-- to), the latest task taken there (`task_id`) and the one status message HQ keeps in the thread
-- for it (`status_ts`, none until it is posted). Replies in a thread HQ holds no row for are never
-- looked at.
CREATE TABLE hq_slack_thread (
  source_key text PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  ask_ts text NOT NULL,
  asker text NOT NULL,
  task_id text,
  status_ts text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
