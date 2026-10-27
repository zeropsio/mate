-- Whether a merged code change was the first of its application's to merge: written by the merge,
-- as the squash lands. None for a change merged before this column, a recipe repository's change
-- (never code), and a change not merged.
ALTER TABLE hq_change ADD COLUMN first_code_merge boolean;
