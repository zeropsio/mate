-- A Mate proves it controls its project (`mateCredentials.ts`): the challenges HQ handed out, each
-- for one project, two minutes and one enrollment.
CREATE TABLE hq_mate_challenge (
  nonce_hash text PRIMARY KEY,
  project_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- The credentials HQ issued Mates that proved their project, by hash only. A project holds one live
-- credential: issuing the next revokes it.
CREATE TABLE hq_mate_credential (
  credential_hash text PRIMARY KEY,
  project_id text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX hq_mate_credential_live ON hq_mate_credential (project_id)
  WHERE revoked_at IS NULL;
