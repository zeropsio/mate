-- Scanner facts retain their original provenance separately. They cannot be combined with live
-- turn identities as exact accounting, and their permanent daily history remains available.
ALTER TABLE hq_usage_origin RENAME TO hq_usage_history_origin;
ALTER TABLE hq_usage_receipt RENAME TO hq_usage_history_receipt;
ALTER TABLE hq_usage_history_receipt DROP COLUMN contribution;
ALTER TABLE hq_usage_fact RENAME TO hq_usage_history_fact;
ALTER TABLE hq_usage_daily RENAME TO hq_usage_history_daily;
DROP TABLE hq_usage_alias;
ALTER TABLE hq_usage_history_origin DROP COLUMN ledger_id, DROP COLUMN writer_id, DROP COLUMN snapshot_coverage;
DROP TABLE hq_usage_prefix;
DROP TABLE hq_usage_producer;
ALTER TABLE hq_usage_state DROP COLUMN protected_revision, DROP COLUMN protected_set, DROP COLUMN protection_verified;
ALTER TABLE hq_usage_history_origin ADD COLUMN recorded_since timestamptz;
UPDATE hq_usage_history_origin o SET recorded_since=(SELECT min(day)::timestamptz FROM hq_usage_history_daily d WHERE d.origin_id=o.origin_id AND d.day<>'unallocated');
UPDATE hq_usage_state SET recovery='verified',revision=revision+1;
CREATE TABLE hq_usage_origin (
  origin_id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL,
  mate_id uuid NOT NULL, provider text NOT NULL, label text NOT NULL, coverage jsonb NOT NULL,
  recorded_since timestamptz, last_app_id text, deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX hq_usage_live_origin_binding ON hq_usage_origin(org_id,project_id,mate_id);
CREATE TABLE hq_usage_receipt (
  origin_id text NOT NULL REFERENCES hq_usage_origin(origin_id), fact_id text NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY(origin_id,fact_id)
);
CREATE TABLE hq_usage_fact (
  origin_id text NOT NULL, fact_id text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(), occurrence timestamptz,
  day text NOT NULL, value jsonb NOT NULL, contribution jsonb NOT NULL,
  PRIMARY KEY(origin_id,fact_id),
  FOREIGN KEY(origin_id,fact_id) REFERENCES hq_usage_receipt(origin_id,fact_id)
);
CREATE INDEX hq_usage_live_fact_page ON hq_usage_fact(occurrence,origin_id,fact_id);
CREATE INDEX hq_usage_live_fact_ingested ON hq_usage_fact(ingested_at);
CREATE TABLE hq_usage_daily (
  origin_id text NOT NULL REFERENCES hq_usage_origin(origin_id), day text NOT NULL,
  meter_version text NOT NULL, statistics jsonb NOT NULL, native_cost jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(origin_id,day,meter_version)
);
CREATE INDEX hq_usage_live_daily_page ON hq_usage_daily(day,origin_id,meter_version);
-- Model participation is separate from headline turns. Never sum these tables together.
CREATE TABLE hq_usage_model_daily (
  origin_id text NOT NULL REFERENCES hq_usage_origin(origin_id), day text NOT NULL,
  model text NOT NULL, pricing_band text NOT NULL, meter_version text NOT NULL, known_components text NOT NULL,
  statistics jsonb NOT NULL, native_cost jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(origin_id,day,model,pricing_band,meter_version,known_components)
);
CREATE INDEX hq_usage_live_model_daily_page ON hq_usage_model_daily(day,origin_id,model,pricing_band,meter_version,known_components);
CREATE OR REPLACE FUNCTION hq_usage_retire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM id FROM hq_usage_state WHERE id=1 FOR UPDATE;
  UPDATE hq_usage_origin SET deleted=true,
    last_app_id=(SELECT app_id::text FROM hq_app_project WHERE project_id=OLD.project_id)
    WHERE mate_id=OLD.usage_id;
  UPDATE hq_usage_history_origin SET deleted=true,
    last_app_id=(SELECT app_id::text FROM hq_app_project WHERE project_id=OLD.project_id)
    WHERE mate_id=OLD.usage_id;
  UPDATE hq_usage_state SET revision=revision+1 WHERE id=1;
  RETURN OLD;
END $$;
