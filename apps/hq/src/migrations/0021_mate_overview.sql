-- A Mate's overview as its link last brought it (`mateOverviews.ts`), kept when its last link goes
-- and when one of its chats changes kind, so a Mate that sleeps keeps its last state across a
-- restart or a takeover. It goes with the Mate's record.
CREATE TABLE hq_mate_overview (
  project_id text PRIMARY KEY REFERENCES hq_mate (project_id) ON DELETE CASCADE,
  overview jsonb NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now()
);
