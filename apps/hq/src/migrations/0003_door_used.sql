-- The door tokens that opened a session: each opens one. Kept 10 minutes, longer than a door token
-- can be young enough to pass (5 minutes either way of the API's clock).
CREATE TABLE hq_door_used (
  token_id text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
