-- What the organization granted the app on an installation, as GitHub tells it
-- (`GET /app/installations/{id}`): a token HQ mints asks for no more (`askedPermissions`), since
-- GitHub refuses one that does. `NULL` on an installation kept before: read again before its first
-- token.
ALTER TABLE hq_github_installation ADD COLUMN permissions jsonb;
