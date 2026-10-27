-- A repository whose code HQ keeps while it follows GitHub: the GitHub repository it follows,
-- fetched by its Mates and never pushed to (`Remotes.follow`). No remote and no credential: what
-- pushes reads `hq_repo_remote`, which a followed repository has no row in.
ALTER TABLE hq_repo ADD COLUMN upstream text CHECK (upstream ~ '^https://');
