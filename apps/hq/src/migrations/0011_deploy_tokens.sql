-- An environment's deploy token (SPEC §3.2b, main E02): minted by the person who attaches it, on
-- their own client, and handed to HQ; HQ deploys the environment with it. Kept apart from the
-- environment's row, so nothing that reads the structure can select it; no API answers it back.
CREATE TABLE hq_deploy_token (
  project_id text PRIMARY KEY REFERENCES hq_environment (project_id) ON DELETE CASCADE,
  token text NOT NULL,
  kept_by text NOT NULL,
  kept_at timestamptz NOT NULL DEFAULT now(),
  -- Since when HQ's check before a deploy found it no longer answering, or reaching more than its
  -- project: an admin must mint a new one. HQ cannot revoke it (its own token is org Read only).
  invalid_since timestamptz
);
