-- Health remains available even when Mate's conversation overview cannot be read.
CREATE TABLE hq_mate_health (
  project_id text PRIMARY KEY REFERENCES hq_mate (project_id) ON DELETE CASCADE,
  health jsonb NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now()
);
