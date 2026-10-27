-- Nothing read what a mirror's last follow of GitHub's other branches and tags did; each ref it
-- removes is logged by name.
ALTER TABLE hq_repo_mirror DROP COLUMN followed_refs;
