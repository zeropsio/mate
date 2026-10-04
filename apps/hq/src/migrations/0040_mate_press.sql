-- A Mate's press, held by the browser running it (B5): which press holds it (`owner`, the press's
-- own id, so two tabs of one person are two presses), whose it is, until when its holder renewed it,
-- and the Zerops process of the container import it asked for, once Zerops answered. Another
-- browser reads it so a press still running is never taken for one that stopped, and a stopped one
-- is finished without waiting on any age. Keyed by the Mate's project: its press attaches it —
-- closing its birth intent — before it imports its container, and a Mate in no application has no
-- intent at all. Its press deletes it when it ends; it goes with its project.
CREATE TABLE hq_mate_press (
  project_id text PRIMARY KEY,
  owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 100),
  held_by text NOT NULL,
  until timestamptz NOT NULL,
  import_process_id text CHECK (length(import_process_id) BETWEEN 1 AND 100)
);
