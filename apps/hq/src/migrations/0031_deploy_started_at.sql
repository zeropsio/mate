-- A deploy is no longer submitted again once it ran past HQ's patience (audit H6): each pass reads
-- where the build HQ submitted stands, however long it runs. When it started is read by nothing.
ALTER TABLE hq_deploy DROP COLUMN started_at;
