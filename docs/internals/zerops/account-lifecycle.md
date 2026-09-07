# Zerops account lifecycle

The hosted client has one account boundary, outside the router and connection runtime. Only the
Zerops callback can run before verification. A saved credential is not verification: Mate checks
`user/info`, then reads current organizations, projects, effective project roles and services before
mounting the product. Registration and second factors belong to the Zerops account application.

## Ownership and authority

The platform inventory owns project/service identity and access. A container URL is a current
address, not an identity. Per-project `userRoles`, matched against the current `clientUser` ID,
override the organization role in either direction. OWNER, ADMIN and BASIC_USER may operate Mate;
READ_ONLY and NO_ACCESS may not. Creating/deleting platform resources remains subject to the
platform's own endpoint permissions.

A renderer owns one verified account lifetime. Closing it invalidates pending work, flushes drafts
and view preferences under their original account keys, requests revocation of its own remote
sessions, and disposes the atom registry and connections. Remote revocation is best effort when
offline. Provider credentials, running agents and accepted commands stay in the container.

Identity changes propagate through browser storage. A second tab drops its runtime and verifies the
new identity. Organization selection and navigation remain per tab. Drafts have separate document
branches, including duplicated tabs; a reload resumes the tab's preceding branch. A new tab can
start from the account's latest saved draft without overwriting the original. These preferences are
local to the browser, not synchronized between devices.

## Restoration and convergence

Only stable project/service targets remembered by the same account can reconnect automatically.
Every restoration validates them against the current inventory; an explicit route wins over the
last route. The server descriptor must identify the expected project before a credential is sent.
Restoration never provisions a missing container. A missing target is unavailable; it does not fall
back to another project's conversation. Drafts retain their environment/thread keys and are not
moved to a replacement environment or sent automatically.

Connection credentials and server snapshots are held in memory for the current login. Historical,
unowned connection catalogs and snapshots are not imported. A login/reload downloads current server
state. On socket replacement, the existing shared shell/thread synchronizers reload authoritative
snapshots; thread history epochs prevent older pages from merging across a history replacement.
This deliberately trades warm offline startup for a smaller, verifiable ownership model.

One inventory supplies overview, sidebar and restore. Direct platform lists and permission-filtered
search are paginated; malformed pages, changing totals and duplicate pages fail the read. Reads use
bounded concurrency. Push, focus, reconnect, confirmed local changes and a visible-tab interval
refresh the inventory. Confirmed deletion/access loss removes a target even when another organization fails. A failed
organization read retains only that scope’s last verified list; successful scopes still converge.
Incomplete access checks conservatively disable mutations and offer retry. Stale content is hidden after the
15-minute verification window; an initial failure never unlocks cached product content.

Platform writes are not automatically replayed after network loss. An ambiguous response is shown
as uncertain, with instructions to inspect the current project/services. The new-project wizard
cannot immediately create a second project from that uncertain attempt. Once project creation
succeeds, a container-import failure is explicitly reported as partial creation. Multi-step
operations check the original session generation before subsequent writes.

## Server door and compatibility

`packages/client-runtime/src/zerops/serverCompatibility.ts` defines the GUI's minimum supported
server version, currently 0.3.0, independently of its own release version. This is the first release
whose descriptor identifies the Zerops project (commit `1e5cb5948`), needed to reject a reassigned
address before transmitting credentials. Only a known version
below that baseline blocks connection before sending the Zerops token. Raise the minimum only
with a documented required protocol change and compatibility evidence. Unrecognized development
versions are not presumed incompatible; the normal descriptor and identity protocol must succeed.
The optional `accountLifecycleVersion: 1` describes the new server semantics; its absence is not a
connection blocker. The project list displays the server-reported version, and an upgrade error
shows both the actual and required versions. Restart recovery uses this same minimum.

Older supported servers retain their original access policy. In particular, they may accept
historical pairing sessions and lack own-session logout. The GUI still clears credentials, closes
connections and locks immediately; server-side invalidation on these older versions relies on
the identity membership TTL. Strict effective-role checks and own-session revocation below require
the updated server. Accepting the old identity protocol does not backport these server guarantees.

On the updated server, an identity-issued grant is still
exchanged at `/oauth/token`; that short internal grant is not a manual pairing flow. Only grants
from the Zerops identity door are accepted in a Zerops environment. Sessions use the
`zerops-user:<id>` subject namespace, rejecting historical manually issued sessions.

Manual browser-session/pairing HTTP endpoints and the `pair`/`auth` CLI groups are removed. Session
cookies are not credentials for Mate HTTP or WebSocket access. `POST /api/auth/logout` revokes the
calling session without administrative scopes. Independent sessions are not replaced merely
because they belong to the same user. Identity sessions expire within the membership window
(default 15 minutes); renewal rechecks effective access, and revocation/expiry closes sockets.

The released surface is hosted web. Desktop uses the same account boundary. Mobile is not released;
its retained entry directs users to hosted Mate, so dormant native connection source cannot become
a pairing escape hatch. A native release requires its own complete account lifecycle implementation.

No database migration deletes history or provider credentials. Old local development records may
remain on disk, but are not part of the signed-in product. Cleanup must use a backed-up, explicit
disposable data directory, never an active developer installation.
