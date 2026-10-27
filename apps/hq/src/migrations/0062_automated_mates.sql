-- Automated Mates (`@t3tools/contracts` `MateTask`): a Mate made to take tasks from outside, a
-- GitHub issue first, and to run only on the organization's API keys. The flag is set with its
-- record, or with the birth intent it is born under, and never changes.
ALTER TABLE hq_mate ADD COLUMN automated boolean NOT NULL DEFAULT false;
ALTER TABLE hq_birth_intent ADD COLUMN automated boolean NOT NULL DEFAULT false;

-- Where an application's automated Mates take tasks from: one GitHub repository of the application
-- (`repo`, `owner/name` as GitHub spells it, lower case; `hq_repo`, the application's repository
-- whose remote it is) and the label its issues carry. GitHub's webhook reaches HQ at
-- `/api/intake/github/<public_id>`, signed with the secret sealed here (`deployKeys.ts`); `hook_id`
-- is the webhook HQ made with the repository's token, none where the person pasted it.
CREATE TABLE hq_intake (
  app_id uuid PRIMARY KEY REFERENCES hq_app (id) ON DELETE CASCADE,
  repo text NOT NULL CHECK (length(repo) BETWEEN 3 AND 200),
  hq_repo text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 50),
  public_id text NOT NULL UNIQUE,
  sealed bytea NOT NULL,
  key_id text NOT NULL,
  hook_id bigint,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A task from outside: an issue an application's intake took in, waiting for one of its automated
-- Mates (`queued`), handed to one (`assigned`, since `assigned_at`), taken by it (`working`, in
-- `conversation_id`), and ended (`done`, `failed` with why in `detail`, or `dropped` while it
-- waited: its issue closed or lost the label). One live task per issue, one per Mate.
CREATE TABLE hq_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  repo text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL,
  author text,
  delivery_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('queued', 'assigned', 'working', 'done', 'failed', 'dropped')),
  mate_project_id text,
  conversation_id text,
  change_repo text,
  change_number integer,
  assigned_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  detail text,
  -- The Mate it was last handed to: given back while that Mate's link was down, its late word is
  -- still taken while the task waits for no other Mate.
  last_mate_project_id text,
  -- Since when its Mates have turned it down, from the first refusal: it fails after 30 minutes.
  declined_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state IN ('assigned', 'working')) = (mate_project_id IS NOT NULL AND assigned_at IS NOT NULL)
    OR state IN ('done', 'failed')),
  CHECK ((change_repo IS NULL) = (change_number IS NULL))
);
CREATE UNIQUE INDEX hq_task_live_issue ON hq_task (app_id, repo, number)
  WHERE state IN ('queued', 'assigned', 'working');
CREATE UNIQUE INDEX hq_task_live_mate ON hq_task (mate_project_id)
  WHERE state IN ('assigned', 'working');
CREATE INDEX hq_task_queued ON hq_task (app_id, seq) WHERE state = 'queued';

-- The organization's API key for each OpenCode key provider (`OPENCODE_KEY_PROVIDERS`), sealed
-- (`deployKeys.ts`); never answered back but to a Mate of the organization.
CREATE TABLE hq_org_ai_key (
  provider text PRIMARY KEY,
  sealed bytea NOT NULL,
  key_id text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
