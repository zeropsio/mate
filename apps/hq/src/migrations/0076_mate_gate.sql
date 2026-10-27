-- The heads a person merged in Mate, by whom and when: HQ's `mate/gate = success` on each, said on
-- GitHub where its app may (`pullRequests.ts`). A merge GitHub made of a head without one landed
-- outside Mate (`landed_outside`, `Changes.landImported`).
CREATE TABLE hq_gate (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  sha text NOT NULL,
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, repo, sha),
  FOREIGN KEY (app_id, repo) REFERENCES hq_repo(app_id, name) ON DELETE CASCADE
);

ALTER TABLE hq_change ADD COLUMN landed_outside boolean NOT NULL DEFAULT false;
