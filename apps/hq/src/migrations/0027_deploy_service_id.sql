-- The Zerops service a deploy's record is for, by its id (audit N6): the hostname names the record,
-- the id says whose it is. A record made for a service its hostname no longer names — deleted, and
-- another made under the same hostname — is that service's, and the one there now starts afresh
-- (`deploys.ts`). None until HQ first reads the service a record names; a record from before is
-- taken by the service its hostname names then.
ALTER TABLE hq_deploy ADD COLUMN service_id text;
