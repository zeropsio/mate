-- An environment's deploy token, sealed (audit D4): AES-256-GCM under HQ's key, `HQ_KEY_SECRET` in
-- HQ's own service env, never in the database nor in a backup set (`deployKeys.ts`). `sealed` holds
-- the nonce, the ciphertext and the tag; `key_id` names the key and the way it was sealed. A token
-- kept before is its plain bytes with no `key_id` until the leading Core seals it at its start, under
-- the lead's lock; a Core without the key leaves it so, and deploys nothing with it.
ALTER TABLE hq_deploy_token RENAME COLUMN token TO sealed;
ALTER TABLE hq_deploy_token
  ALTER COLUMN sealed TYPE bytea USING convert_to(sealed, 'UTF8'),
  ADD COLUMN key_id text;
