-- Discord (`discord.ts`): the organization's Discord application — its id and public key as the
-- Developer Portal shows them, its bot token sealed (`deployKeys.ts`, bound to the application and
-- `public_id`) — at most one. Discord sends its interactions to `/api/intake/discord/<public_id>`.
CREATE TABLE hq_discord (
  one boolean PRIMARY KEY DEFAULT true CHECK (one),
  application_id text NOT NULL CHECK (application_id ~ '^[0-9]{1,20}$'),
  public_key text NOT NULL CHECK (public_key ~ '^[0-9a-f]{64}$'),
  public_id text NOT NULL UNIQUE,
  sealed bytea NOT NULL,
  key_id text NOT NULL,
  connected_by text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- The Discord users who may start and steer tasks, by their user id; kept while the application is
-- disconnected, so connecting again keeps the list.
CREATE TABLE hq_discord_allowed (
  user_id text PRIMARY KEY CHECK (user_id ~ '^[0-9]{1,20}$'),
  added_by text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- The one channel each application takes tasks from, with the names people know it and its server
-- by, read when it was set. One application per channel.
CREATE TABLE hq_discord_channel (
  app_id uuid PRIMARY KEY REFERENCES hq_app (id) ON DELETE CASCADE,
  channel_id text NOT NULL UNIQUE CHECK (channel_id ~ '^[0-9]{1,20}$'),
  channel text NOT NULL,
  guild_id text NOT NULL,
  server text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

-- The one status message HQ posted in a task's thread, edited as the task moves.
CREATE TABLE hq_discord_status (
  thread_id text PRIMARY KEY,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
