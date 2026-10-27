-- Additive: old leaders can ignore this lane. Permanent rows deliberately have no FK to live
-- registrations. Never restore or purge receipts separately from daily cells and producer cursors.
ALTER TABLE hq_mate ADD COLUMN usage_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE hq_usage_state (
  id integer PRIMARY KEY CHECK (id = 1),
  revision numeric(38,0) NOT NULL DEFAULT 0,
  exact_since timestamptz,
  recovery text NOT NULL DEFAULT 'unknown',
  protected_revision numeric(38,0),
  protected_set text,
  protection_verified boolean NOT NULL DEFAULT false
);
INSERT INTO hq_usage_state(id) VALUES(1);
CREATE TABLE hq_usage_producer (
  ledger_id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL,
  mate_id uuid NOT NULL, channel text NOT NULL, process_id text NOT NULL,
  cursor numeric(38,0) NOT NULL DEFAULT 0, digest text NOT NULL,
  snapshot jsonb
);
CREATE TABLE hq_usage_prefix (
  ledger_id text NOT NULL REFERENCES hq_usage_producer(ledger_id),
  sequence numeric(38,0) NOT NULL, digest text NOT NULL,
  PRIMARY KEY(ledger_id, sequence)
);
CREATE TABLE hq_usage_origin (
  origin_id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL,
  mate_id uuid NOT NULL, ledger_id text NOT NULL REFERENCES hq_usage_producer(ledger_id),
  writer_id text NOT NULL, provider text NOT NULL, label text NOT NULL,
  coverage jsonb NOT NULL, snapshot_coverage jsonb, last_app_id text,
  deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX hq_usage_origin_binding ON hq_usage_origin(org_id, project_id, mate_id);
CREATE TABLE hq_usage_receipt (
  origin_id text NOT NULL REFERENCES hq_usage_origin(origin_id), native_id text NOT NULL,
  fact_id text NOT NULL, revision numeric(38,0) NOT NULL,
  digest text NOT NULL, contribution jsonb,
  PRIMARY KEY(origin_id, native_id), UNIQUE(origin_id, fact_id)
);
CREATE TABLE hq_usage_alias (
  origin_id text NOT NULL, alias text NOT NULL, native_id text NOT NULL,
  PRIMARY KEY(origin_id, alias),
  FOREIGN KEY(origin_id, native_id) REFERENCES hq_usage_receipt(origin_id, native_id)
);
CREATE TABLE hq_usage_fact (
  origin_id text NOT NULL, native_id text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(), occurrence timestamptz, day text NOT NULL, model text NOT NULL, value jsonb NOT NULL,
  PRIMARY KEY(origin_id, native_id),
  FOREIGN KEY(origin_id, native_id) REFERENCES hq_usage_receipt(origin_id, native_id)
);
CREATE INDEX hq_usage_fact_period ON hq_usage_fact(origin_id, occurrence, native_id);
CREATE TABLE hq_usage_daily (
  origin_id text NOT NULL REFERENCES hq_usage_origin(origin_id), day text NOT NULL,
  model text NOT NULL, pricing_band text NOT NULL, meter_version text NOT NULL, known_components text NOT NULL,
  statistics jsonb NOT NULL, native_cost jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(origin_id, day, model, pricing_band, meter_version, known_components)
);
CREATE INDEX hq_usage_daily_period ON hq_usage_daily(day, origin_id);
-- Pricing policies are one coherent automatic revision, independent of normalized token facts.
CREATE TABLE hq_usage_price (
  revision text NOT NULL, model text NOT NULL, pricing_band text NOT NULL,
  rates jsonb NOT NULL, provenance text NOT NULL,
  PRIMARY KEY(revision, model, pricing_band)
);
CREATE TABLE hq_usage_price_policy (
  id integer PRIMARY KEY CHECK(id=1), revision text NOT NULL
);
INSERT INTO hq_usage_price_policy VALUES(1, 'unavailable');
-- Exact bigint/decimal arithmetic and fail-fast aggregate checks, including correction subtraction.
CREATE FUNCTION hq_usage_add(a jsonb, b jsonb, sign integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb := coalesce(a, '{}'); field text; amount numeric;
BEGIN
  FOR field IN SELECT jsonb_object_keys(b) LOOP
    amount := coalesce((result->>field)::numeric, 0) + (b->>field)::numeric * sign;
    IF amount < 0 OR amount >= power(10::numeric,38) OR trunc(amount) <> amount THEN
      RAISE EXCEPTION 'invalid usage aggregate %', field;
    END IF;
    result := jsonb_set(result, ARRAY[field], to_jsonb(amount::text));
  END LOOP;
  RETURN result;
END $$;
CREATE TABLE hq_usage_sender (
  project_id text PRIMARY KEY, channel text NOT NULL, process_id text NOT NULL
);
CREATE FUNCTION hq_usage_sum_step(a jsonb,b jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT hq_usage_add(a,b,1) $$;
CREATE AGGREGATE hq_usage_sum(jsonb)(SFUNC=hq_usage_sum_step,STYPE=jsonb,INITCOND='{}');
-- Stable registration retirement is proved by the structure writer, never by socket silence.
CREATE FUNCTION hq_usage_retire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM id FROM hq_usage_state WHERE id=1 FOR UPDATE;
  UPDATE hq_usage_origin SET deleted=true,
    last_app_id=(SELECT app_id::text FROM hq_app_project WHERE project_id=OLD.project_id)
    WHERE mate_id=OLD.usage_id;
  UPDATE hq_usage_state SET revision=revision+1 WHERE id=1;
  RETURN OLD;
END $$;
CREATE TRIGGER hq_usage_retire BEFORE DELETE ON hq_mate FOR EACH ROW EXECUTE FUNCTION hq_usage_retire();
UPDATE hq_usage_state SET exact_since=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '30 days' WHERE id=1;
CREATE INDEX hq_usage_fact_page ON hq_usage_fact(occurrence,origin_id,native_id);
CREATE INDEX hq_usage_daily_page ON hq_usage_daily(day,origin_id,model,pricing_band,meter_version,known_components);

CREATE INDEX hq_usage_fact_ingested ON hq_usage_fact(ingested_at);
