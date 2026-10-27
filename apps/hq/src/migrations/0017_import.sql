-- The migration from main (T13, `importJob.ts`): the one bundle this HQ imports, by its manifest's
-- digest, as the import command queued it and the leader ran it; and each item of it the leader
-- wrote, with what it made, in the transaction that wrote it, so a run that died resumes after the
-- last item it finished and writes none twice. Migration-only: these go with T14.
CREATE TABLE hq_import (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  dir text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'failed', 'done')),
  error text,
  report jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One HQ, one import: another bundle is refused, whatever became of the first.
CREATE UNIQUE INDEX hq_import_one ON hq_import ((true));

CREATE TABLE hq_import_item (
  digest text NOT NULL REFERENCES hq_import (digest),
  key text NOT NULL,
  target jsonb NOT NULL DEFAULT '{}',
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (digest, key)
);
