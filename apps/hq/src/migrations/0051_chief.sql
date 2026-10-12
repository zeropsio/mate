-- A person's Chief (`chief.ts`): the project they registered, and the credential HQ answered them,
-- by its hash only. A person holds one live registration in an org, and a project is one person's
-- Chief: the next registration revokes the one before.
CREATE TABLE hq_chief (
  credential_hash text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  project_id text NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX hq_chief_live_person ON hq_chief (org_id, user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX hq_chief_live_project ON hq_chief (project_id) WHERE revoked_at IS NULL;

-- What a person decided on a Chief's proposal (`proposals.ts`), against the project of the
-- conversation its card sits in: the decision once, an approval's outcome once after it.
CREATE TABLE hq_proposal_decision (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'declined')),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  outcome text CHECK (outcome IN ('done', 'failed')),
  words text,
  outcome_by text,
  outcome_at timestamptz,
  CHECK (outcome IS NULL OR decision = 'approved')
);
