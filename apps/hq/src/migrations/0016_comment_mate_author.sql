-- A comment's author is a person or a Mate, never both and never neither. A Mate's comment is one it
-- made on main's Gitea, brought over by the migration (T13); HQ's API takes a person's only.
ALTER TABLE hq_change_comment ALTER COLUMN author_user_id DROP NOT NULL;
ALTER TABLE hq_change_comment ADD COLUMN author_mate_project_id text;
ALTER TABLE hq_change_comment ADD CONSTRAINT hq_change_comment_one_author
  CHECK (num_nonnulls(author_user_id, author_mate_project_id) = 1);
