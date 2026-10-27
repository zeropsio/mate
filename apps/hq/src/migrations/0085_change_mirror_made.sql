-- Whether HQ made the change's branch on GitHub: its own push created it there. HQ moves only a
-- branch it made, leased on the commit it last pushed; one it found there (a Mate's own push, a
-- branch people keep, such as one a deploy pipeline acts on) it follows, and never pushes to
-- (`githubMirror.ts`).
ALTER TABLE hq_change_mirror ADD COLUMN made boolean NOT NULL DEFAULT false;
-- Until now HQ pushed only the branches of changes opened without one (`mate/<n>-<slug>`), which it
-- names and makes itself; a branch a Mate named it only followed.
UPDATE hq_change_mirror m SET made = true
FROM hq_change c
WHERE c.app_id = m.app_id AND c.repo = m.repo AND c.number = m.number
  AND (c.branch = 'mate' OR c.branch LIKE 'mate/%');
