-- The pull request each change of a repository HQ mirrors through the organization's GitHub app is
-- kept as (`pullRequests.ts`): one per change, opened by the app's bot on the change's branch.
-- `head_sha` is the head GitHub was last given; `checks` what GitHub's checks said of it;
-- `checks_told_sha`/`checks_told` the failing heads its Mate heard of (at most three, then
-- `checks_given_up`); `described` what HQ last wrote of the change into its body; `merged_sha`
-- the commit GitHub's merge of it made, and `merged_head` the head it merged.
CREATE TABLE hq_pull_request (
  app_id uuid NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL,
  github_repo text NOT NULL,
  pr_number integer NOT NULL CHECK (pr_number > 0),
  url text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'merged', 'closed')),
  head_sha text,
  checks text CHECK (checks IN ('pending', 'passing', 'failing')),
  checks_told_sha text,
  checks_told integer NOT NULL DEFAULT 0,
  checks_given_up boolean NOT NULL DEFAULT false,
  first_comment_id bigint,
  described text,
  merged_sha text,
  merged_head text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, repo, number),
  FOREIGN KEY (app_id, repo, number) REFERENCES hq_change (app_id, repo, number) ON DELETE CASCADE
);

-- GitHub's events name a pull request by its repository and number.
CREATE UNIQUE INDEX hq_pull_request_on_github ON hq_pull_request (lower(github_repo), pr_number);

-- A comment said on a change's pull request on GitHub, by its GitHub login; `github_key` names it
-- there (`review:<id>`, `review_comment:<id>`, `issue_comment:<id>`), so a delivery GitHub repeats
-- is kept once.
ALTER TABLE hq_change_comment ADD COLUMN author_github_login text;
ALTER TABLE hq_change_comment ADD COLUMN github_key text;
ALTER TABLE hq_change_comment DROP CONSTRAINT hq_change_comment_one_author;
ALTER TABLE hq_change_comment ADD CONSTRAINT hq_change_comment_one_author
  CHECK (num_nonnulls(author_user_id, author_mate_project_id, author_github_login) = 1);
CREATE UNIQUE INDEX hq_change_comment_github ON hq_change_comment (app_id, repo, number, github_key)
  WHERE github_key IS NOT NULL;
