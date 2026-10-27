-- The leader's epoch. The instance that takes the advisory lock raises it (`leader.ts`), so a
-- takeover is visible to every later read: the first holder leads under epoch 1.
CREATE TABLE hq_leader (
  id integer PRIMARY KEY CHECK (id = 1),
  epoch bigint NOT NULL,
  acquired_at timestamptz
);

INSERT INTO hq_leader (id, epoch) VALUES (1, 0);
