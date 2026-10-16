-- A person's first sign-in at this HQ is their earliest session, and the HQ's first person is the
-- one who set it up: both read by the person's own navigation (`hqScopes`), so both are indexed.
CREATE INDEX hq_session_user_created ON hq_session (user_id, created_at);
CREATE INDEX hq_session_created ON hq_session (created_at);
