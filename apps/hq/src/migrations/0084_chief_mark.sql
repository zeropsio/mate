-- The organisation's Chief (`chief.ts`): the one project an Owner or Admin marks, and since when the
-- mark names it. Moving the mark replaces the row; removing it deletes the row.
CREATE TABLE hq_chief_mark (
  org_id text PRIMARY KEY,
  project_id text NOT NULL,
  since timestamptz NOT NULL DEFAULT now()
);
