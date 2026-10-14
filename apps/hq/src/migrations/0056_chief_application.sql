-- Keep personal application identity after its project placement is removed.
ALTER TABLE hq_chief ADD COLUMN app_id uuid REFERENCES hq_app(id) ON DELETE SET NULL;

UPDATE hq_chief AS chief
SET app_id = placement.app_id
FROM hq_app_project AS placement
WHERE placement.project_id = chief.project_id;
