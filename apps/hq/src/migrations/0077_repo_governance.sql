-- Whether GitHub lets only what Mate approved reach a mirrored repository's default branch, as the
-- mirror last read its rules (`githubProbes.ts` `governanceOf`): `governed`, or advisory by why.
ALTER TABLE hq_repo_mirror ADD COLUMN governance text;
