-- Mate metadata belongs to HQ, joined to Zerops projects by id.
ALTER TABLE hq_birth_intent ADD COLUMN project_id text UNIQUE;
ALTER TABLE hq_mate ADD COLUMN birth_id uuid;
ALTER TABLE hq_mate ADD COLUMN signers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE hq_mate ADD COLUMN name_source text;
CREATE TABLE hq_tool (
  project_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'gitea')
);
