-- The model the organization's automated Mates run each new task on (`HqTaskLimitsView.model`), an
-- OpenCode slug of the offered list (`automatedModels`); none: the default.
ALTER TABLE hq_task_limits ADD COLUMN automated_model text;
