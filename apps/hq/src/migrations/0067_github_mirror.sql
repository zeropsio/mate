-- The git mirror to GitHub (`githubMirror.ts`): a repository reached through the organization's
-- GitHub app (`via = 'app'`, no token kept) follows GitHub's default branch, and each of its open
-- changes is pushed to a branch of its own there. `via` is the GitHub app's part's column as well:
-- whichever migration runs first adds it.
ALTER TABLE hq_repo_remote
  ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'token' CHECK (via IN ('app', 'token'));

-- How the repository last followed GitHub: the default branch read, the commit both stood at, and
-- since when neither contains the other (nothing moves while it is set).
CREATE TABLE hq_repo_mirror (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  branch text NOT NULL,
  synced_sha text,
  synced_at timestamptz,
  diverged_since timestamptz,
  PRIMARY KEY (app_id, repo),
  FOREIGN KEY (app_id, repo) REFERENCES hq_repo(app_id, name) ON DELETE CASCADE
);

-- A change's branch on GitHub, `mate/<number>-<slug of its title>`: named on its first push and
-- kept, with the commit last pushed there, which the next push is leased against; and, once
-- GitHub's branch and the change's head hold commits the other does not, the head it diverged at
-- and since when (nothing is pushed while the head is still that one).
CREATE TABLE hq_change_mirror (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL,
  branch text NOT NULL,
  pushed_sha text NOT NULL,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  diverged_head text,
  diverged_since timestamptz,
  CHECK ((diverged_head IS NULL) = (diverged_since IS NULL)),
  PRIMARY KEY (app_id, repo, number),
  FOREIGN KEY (app_id, repo, number) REFERENCES hq_change(app_id, repo, number) ON DELETE CASCADE
);
