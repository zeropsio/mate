-- What a change's record says of it beside its words: when it last moved (a push, an edit of its
-- words, a comment), and whether it merges into main as HQ last judged it (`gitHost.ts`), so a
-- list draws it without reading git.
ALTER TABLE hq_change ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE hq_change SET updated_at = opened_at;
ALTER TABLE hq_change ADD COLUMN mergeability text NOT NULL DEFAULT 'unknown'
  CHECK (mergeability IN ('clean', 'conflict', 'empty', 'already_merged', 'unrelated', 'unknown'));
ALTER TABLE hq_change ADD COLUMN behind boolean NOT NULL DEFAULT false;
