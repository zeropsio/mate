-- A Mate's record stands on its own: a Mate outside any application keeps its name and face, and
-- its membership in an application is the separate, optional row of hq_app_project.
ALTER TABLE hq_mate DROP CONSTRAINT hq_mate_project_id_fkey;
ALTER TABLE hq_mate ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
