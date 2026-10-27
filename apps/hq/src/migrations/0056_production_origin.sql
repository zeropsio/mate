-- Historical attachments carry no proof of who created their Zerops project.
ALTER TABLE hq_environment ADD COLUMN created_for_production boolean NOT NULL DEFAULT false;
ALTER TABLE hq_environment ADD CHECK (NOT created_for_production OR (target = 'zerops' AND tier = 'production'));
