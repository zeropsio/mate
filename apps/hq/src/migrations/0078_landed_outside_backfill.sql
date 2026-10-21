-- A change GitHub merged before HQ recorded the heads a person merged in Mate (0076) reads as merged
-- outside Mate, as `Changes.landImported` decides it now: merged by GitHub, of a head no `hq_gate`
-- row names.
UPDATE hq_change c SET landed_outside = true
WHERE c.state = 'merged'
  AND EXISTS (
    SELECT 1 FROM hq_git_event e
    WHERE e.kind = 'merged' AND e.app_id = c.app_id AND e.repo = c.repo AND e.number = c.number
      AND e.data->>'by' = 'github')
  AND NOT EXISTS (
    SELECT 1 FROM hq_gate g
    WHERE g.app_id = c.app_id AND g.repo = c.repo AND g.sha = COALESCE(c.landed_head, c.head));
