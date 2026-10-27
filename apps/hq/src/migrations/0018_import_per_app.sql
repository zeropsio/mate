-- The migration from main by application (`importCli.ts`): a later application's bundle imports
-- into the same HQ, and each application comes with one import only — its main key, the bundle's
-- `app.key`, kept with the digest that brought it. One import runs at a time. Migration-only: these
-- go with T14.
DROP INDEX hq_import_one;

CREATE TABLE hq_import_app (
  app_key text PRIMARY KEY,
  digest text NOT NULL REFERENCES hq_import (digest)
);

-- An import from before this file: its applications, as its run recorded them.
INSERT INTO hq_import_app (app_key, digest)
SELECT substr(key, length('app:') + 1), digest FROM hq_import_item WHERE key LIKE 'app:%';

CREATE UNIQUE INDEX hq_import_unfinished ON hq_import ((true)) WHERE state <> 'done';
