-- One Mate per project (audit D2): the zcp service a Mate's record names as its Mate — the first that
-- enrolls naming itself (`mateCredentials.ts`) — and the service each credential was issued to, none
-- for an older zcp's. Another zcp service of the project is refused its enrollment, and never
-- revokes the Mate's credential; one that Zerops no longer has gives its place to the next.
ALTER TABLE hq_mate ADD COLUMN service_id text;
ALTER TABLE hq_mate_credential ADD COLUMN service_id text;
