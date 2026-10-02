-- A Mate's changes (SPEC §3.2a): the repositories HQ keeps for an application, the changes Mates
-- deliver into them, what people say about a change, its pictures, and the durable log of what
-- happened to them all. Every write goes through the leader's fenced transaction (`leader.ts`).

-- A bare repository at `<git root>/<app_id>/<name>.git`; `main_head` is `main` as HQ last knew it.
CREATE TABLE hq_repo (
  app_id uuid NOT NULL REFERENCES hq_app (id),
  name text NOT NULL CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  main_head text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, name)
);

-- A change: a Mate's work toward `main`, on the branch `mate/<mate_project_id>/<number>`. The number
-- grows within the repository; `head` is the branch as last pushed, none before the first push.
CREATE TABLE hq_change (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  mate_project_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'merged', 'closed')),
  head text,
  merged_sha text,
  landed_head text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  merged_at timestamptz,
  closed_at timestamptz,
  PRIMARY KEY (app_id, repo, number),
  FOREIGN KEY (app_id, repo) REFERENCES hq_repo (app_id, name)
);

-- A Mate has at most one open change in a repository.
CREATE UNIQUE INDEX hq_change_one_open ON hq_change (app_id, repo, mate_project_id)
  WHERE state = 'open';

-- A person's comment on a change.
CREATE TABLE hq_change_comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL,
  author_user_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_id, repo, number) REFERENCES hq_change (app_id, repo, number)
);
CREATE INDEX hq_change_comment_order ON hq_change_comment (app_id, repo, number, created_at);

-- A picture for a change's description: a PNG the Mate sent.
CREATE TABLE hq_change_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_id, repo, number) REFERENCES hq_change (app_id, repo, number)
);

-- What happened, in order: a reader resumes after the last `seq` it read. Written with the change
-- it records, or by the git layer's events; a takeover adds what the refs show was missed.
CREATE TABLE hq_git_event (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL
    CHECK (kind IN ('pushed', 'opened', 'main_moved', 'merged', 'closed', 'commented')),
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer,
  data jsonb NOT NULL DEFAULT '{}'
);
