-- The organization's own GitHub app (`githubApp.ts`), made through GitHub's manifest flow: one per
-- HQ. GitHub sends the app's events to `/api/github/app/webhook/<public_id>`, the address its
-- manifest names: made at the first manifest and kept, so a manifest asked for twice names one
-- address. Made, it holds GitHub's app (`github_id`, `slug`, the `owner` account, its page
-- `html_url`, `client_id`) and its private key, webhook secret and client secret, each sealed under
-- HQ's key (`deployKeys.ts`, `key_id`); none of them before GitHub made it.
CREATE TABLE hq_github_app (
  one boolean PRIMARY KEY DEFAULT true CHECK (one),
  public_id text NOT NULL UNIQUE,
  github_id bigint,
  slug text,
  owner text,
  html_url text,
  client_id text,
  pem_sealed bytea,
  secret_sealed bytea,
  client_secret_sealed bytea,
  key_id text,
  made_by text,
  made_at timestamptz,
  CHECK (
    (github_id IS NULL) = (slug IS NULL)
    AND (github_id IS NULL) = (owner IS NULL)
    AND (github_id IS NULL) = (html_url IS NULL)
    AND (github_id IS NULL) = (pem_sealed IS NULL)
    AND (github_id IS NULL) = (secret_sealed IS NULL)
    AND (github_id IS NULL) = (key_id IS NULL)
  )
);

-- Where the app is installed: an account (`account`, an organization or a person), whether it
-- reaches all of its repositories or those chosen, suspended or not, and the repositories it
-- reaches as GitHub last listed them (`repositories`, `[{ id, fullName, private, defaultBranch }]`,
-- listed at `repositories_at`).
CREATE TABLE hq_github_installation (
  id bigint PRIMARY KEY,
  account text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('Organization', 'User')),
  repository_selection text NOT NULL CHECK (repository_selection IN ('all', 'selected')),
  suspended boolean NOT NULL DEFAULT false,
  repositories jsonb NOT NULL DEFAULT '[]',
  repositories_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hq_github_installation_account ON hq_github_installation (lower(account));

-- One trip through GitHub's pages, from the manifest to the installation: who started it, the
-- account that owns the app (`owner`, none for the person's own), the Mate page the browser goes
-- back to (`return_to`), and when GitHub made the app on it (`made_at`). Good for an hour, used
-- once.
CREATE TABLE hq_github_app_state (
  state text PRIMARY KEY,
  user_id text NOT NULL,
  owner text,
  return_to text NOT NULL,
  made_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- How HQ reaches a repository's remote: a person's token, sealed in the row, or the organization's
-- GitHub app, which keeps none (`via = 'app'`; `host_repo_id` is the repository's id on GitHub).
ALTER TABLE hq_repo_remote
  ADD COLUMN via text NOT NULL DEFAULT 'token' CHECK (via IN ('token', 'app')),
  ADD CONSTRAINT hq_repo_remote_via_sealed CHECK (via = 'token' OR sealed IS NULL);
