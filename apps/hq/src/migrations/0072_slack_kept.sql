-- What the organization's Slack keeps across its connections (`slack.ts`):
-- - `mapped_team_id`: the workspace its applications' channels and threads belong to, kept while
--   it is disconnected; connected again to the same workspace they stay, to another they go.
-- - `bot_name`: the bot's own name in the workspace (`auth.test`), which people invite to a channel.
-- - `refused_at` / `accepted_at`: the last time an event's signature did not hold, and the last
--   time one did: while the refusal is the later, the signing secret HQ holds is not the app's.
ALTER TABLE hq_slack
  ADD COLUMN mapped_team_id text,
  ADD COLUMN bot_name text,
  ADD COLUMN refused_at timestamptz,
  ADD COLUMN accepted_at timestamptz;
UPDATE hq_slack SET mapped_team_id = team_id;
