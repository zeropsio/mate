-- Person-bound HTTPS Git passwords are separate from client sessions and Mate credentials.
-- The application is an id, not a copied name or group permission. Only the SHA-256 is kept.
CREATE TABLE hq_git_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL,
  org_id text NOT NULL,
  app_id uuid NOT NULL REFERENCES hq_app(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX hq_git_credential_holder ON hq_git_credential(user_id, app_id);
