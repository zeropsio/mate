-- A Mate's project that is also its application's stage (main's "Dev / Stage"): a Mate by its
-- record and its rules, a stage by the one-production rule.
ALTER TABLE hq_app_project DROP CONSTRAINT hq_app_project_kind_check;
ALTER TABLE hq_app_project ADD CONSTRAINT hq_app_project_kind_check
  CHECK (kind IN ('mate', 'devstage', 'stage', 'production'));
