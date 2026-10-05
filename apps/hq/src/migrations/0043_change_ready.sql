-- Whether a change asks for review: the head the Mate last described it at. A change is a draft —
-- reachable, never asking — while that is none or another than its head: before its first
-- description, and again after a push the words have not caught up with. A description with words
-- sets it to the head, an empty one clears it, a title leaves it. A change already described keeps
-- asking at the head it has, as it did before this column.
ALTER TABLE hq_change ADD COLUMN ready_head text;
UPDATE hq_change SET ready_head = head WHERE btrim(body) <> '';
