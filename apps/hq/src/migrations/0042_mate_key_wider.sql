-- The id of a key a Mate named that also reads other projects — the READ_ONLY grants on siblings
-- an earlier client gave a Mate's key (ADR 0003's fallout). Kept only to say the Mate needs Finish
-- setup, and to read the key again once Finish setup took those grants off; never the Mate's key,
-- which HQ keeps only where its one grant is the Mate's own project (`hq_mate_credential`).
-- Idempotent: an HQ that ran a pass-40 Core applied this file as 0037_mate_key_wider.sql.
ALTER TABLE hq_mate ADD COLUMN IF NOT EXISTS key_wider_token_id text;
