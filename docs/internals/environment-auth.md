# Environment authentication

Mate's product entry is the [Zerops account lifecycle](zerops/account-lifecycle.md). The environment
and retained relay code have separate credentials and issuers; relay plumbing is not a product
onboarding path.

## Zerops entry

`POST /api/auth/zerops-identity` verifies the caller against the platform and resolves their
effective role for this container's project. Project overrides can lower organization access.
The door returns a short-lived internal grant. `/oauth/token` exchanges only a Zerops identity grant
inside a Zerops environment; ordinary historical pairing grants cannot create a session.

There is no browser-cookie bootstrap, pairing-token/list/revoke HTTP endpoint, startup QR code,
`pair` command or `auth` CLI group. HTTP and WebSocket requests ignore session cookies. Historical
sessions outside the `zerops-user:<id>` namespace are rejected, including WebSocket tickets.

## Session scopes and lifetime

| Scope                   | Permission                                                     |
| ----------------------- | -------------------------------------------------------------- |
| `orchestration:read`    | Read snapshots, events, configuration and filesystem/VCS state |
| `orchestration:operate` | Dispatch workspace and agent operations                        |
| `terminal:operate`      | Operate terminals                                              |
| `review:write`          | Compose review feedback                                        |
| `access:read`           | Inspect retained access administration models                  |
| `access:write`          | Revoke other client sessions through administration endpoints  |
| `relay:read`            | Inspect retained relay configuration                           |
| `relay:write`           | Manage retained relay configuration                            |

Requested scopes must be contained in the identity grant. Normal clients receive operation scopes,
not access administration. Effective platform permissions are checked before that grant is issued.
All identity sessions have a bounded membership window (default 15 minutes), for bearer and DPoP
exchange alike. Refreshing through the identity door verifies current access again. Separate
sessions for the same subject do not replace one another.

`POST /api/auth/logout` requires authentication and revokes exactly the calling session, without
`access:write`. Revocation and expiry close the session's sockets. Accepted orchestration commands,
provider sessions and provider credentials have environment lifetime, not browser-session lifetime.
Offline logout locks the renderer immediately; unreachable server sessions expire at their deadline.

## Media preview access

Clients with `orchestration:read` can request a `media-file` URL through `assets.createUrl` for
supported images and videos anywhere the environment's server account can read. A thread ID supplies
the workspace for relative paths; absolute paths refer to the environment host, not the client —
the same reach `terminal:operate` already has. [`AssetAccess.ts`](../../apps/server/src/assets/AssetAccess.ts)
resolves symlinks, requires a regular file, validates the resolved file's extension, and signs its
canonical path and device/inode identity for one hour. Serving rechecks the path, media type and the
opened descriptor's identity. Signed asset URLs are bearer credentials until they expire. Video reads
support byte ranges and are served `private, no-store` without validators.

## Transport

HTTP uses `Authorization: Bearer <token>` or the existing DPoP proof-bound session protocol. Browser
WebSockets use a short-lived ticket from `POST /api/auth/websocket-ticket`, bound to a valid session.
Ticket verification also enforces identity provenance. Credential responses are not cacheable.
Origin and DPoP request checks remain in force.

The GUI checks the shared minimum server version and expected Zerops project before submitting
its platform credential. The optional lifecycle capability does not block otherwise supported
versions. The minimum is 0.7.0 for effective project roles, identity-only sessions and own-session
logout, activated after zcp 9.170.0 publication. Older servers require an upgrade. See the
[release and recovery procedure](../operations/account-lifecycle-release.md).

The database retains existing auth table names and internal grant storage. There is no destructive
migration of conversation history or credentials. Retained low-level schemas and relay source do
not re-enable the removed public product flows.
