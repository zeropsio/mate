-- What the mirror's last follow of GitHub's other branches and tags did (`HqGit.followRefs`): how
-- many came in or moved (`fetched`), and the refs GitHub no longer has that left HQ's copy with it
-- (`pruned`, full names under `refs/github/`).
ALTER TABLE hq_repo_mirror ADD COLUMN followed_refs jsonb;
