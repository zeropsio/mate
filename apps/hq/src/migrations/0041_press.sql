-- Every press, held by the browser running it (B5): a Mate's, or a stage's or a production's. Which
-- press holds it (`owner`, the press's own id, so two tabs of one person are two presses), whose it
-- is, what it makes (`kind` — a stage's or a production's tier is what its registration attaches
-- it as) and into which application, until when its holder renewed it, and the Zerops process of
-- the container import it asked for, once Zerops answered. Taken when Zerops accepts the project.
-- Another browser reads it so a press still running is never taken for one that stopped, and a
-- project a press made and never registered is never taken for one HQ simply does not hold: its
-- setup is finished for its kind. Keyed by the project: a Mate's press attaches it — closing its
-- birth intent — before it imports its container, and a Mate in no application has no intent at
-- all. A press that finishes deletes it; one that stops ends its hold and keeps it. It goes with
-- its project.
CREATE TABLE hq_press (
  project_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('mate', 'stage', 'production')),
  app_id uuid REFERENCES hq_app (id) ON DELETE SET NULL,
  owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 100),
  held_by text NOT NULL,
  until timestamptz NOT NULL,
  import_process_id text CHECK (length(import_process_id) BETWEEN 1 AND 100)
);
