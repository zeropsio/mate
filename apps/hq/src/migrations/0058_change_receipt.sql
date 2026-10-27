-- The last receipt zcp wrote on a change of several parts, whole (`ChangeReceipt`); none until then.
ALTER TABLE hq_change ADD COLUMN receipt jsonb;
