-- A Mate is its maker's for good (`usageOwner`): a later sign-in no longer moves it. A Mate signed
-- in before this was its signer's, and stays so: its record names that signer as its maker, as the
-- person it belongs to; one nobody signed in keeps the maker it names.
UPDATE hq_mate
SET made_by = COALESCE(signers ->> 'claude-code', signers ->> 'codex')
WHERE COALESCE(signers ->> 'claude-code', signers ->> 'codex') IS NOT NULL
  AND made_by IS DISTINCT FROM COALESCE(signers ->> 'claude-code', signers ->> 'codex');
