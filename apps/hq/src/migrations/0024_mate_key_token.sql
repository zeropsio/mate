-- The id of the Zerops key a Mate's container holds, as the Mate named it to HQ — at its enrollment,
-- and again with its credential (`mateCredentials.ts`): an id, never a value. A Mate's key is found
-- by it — adopting the Mate lowers it, deleting the Mate retires it — and never by matching the
-- organization's token list. With its credential; a credential issued without one keeps the id the
-- live one before it named.
ALTER TABLE hq_mate_credential ADD COLUMN key_token_id text;
