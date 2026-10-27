-- What HQ last saw of each application's tier that its environments are made from (main D15): the
-- import file's digest, and each service's declaration as compared (`recipeDeltas.ts`). A change
-- imports what it added into every environment of the tier. Kept here, where main's broker kept it
-- in memory and so only reported on its first pass after a restart (D16): HQ's first pass after a
-- restart is a pass like any other.
CREATE TABLE hq_recipe_seen (
  app_id uuid NOT NULL REFERENCES hq_app (id),
  tier text NOT NULL CHECK (tier IN ('stage', 'production')),
  digest text NOT NULL,
  blocks jsonb NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tier)
);
