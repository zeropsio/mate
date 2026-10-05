-- The time before which a production follows no release: set to the moment an attach or a
-- replacement creates the production, so a production deploys only releases made after it was
-- attached. None for every environment that exists before this column, and for a stage: a
-- production kept as it was follows the newest approved release, whenever it was made.
ALTER TABLE hq_environment ADD COLUMN release_floor timestamptz;
