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
Until 0.6, an incomplete access check conservatively disables mutations and offers retry; the
per-project admission below replaces it. Stale content is hidden after the verification window; an
initial failure never unlocks cached product content.

Platform writes are not automatically replayed after network loss. An ambiguous response is shown
as uncertain, with instructions to inspect the current project/services. The new-project wizard
cannot immediately create a second project from that uncertain attempt. Once project creation
succeeds, a container-import failure is explicitly reported as partial creation. Multi-step
operations check the original session generation before subsequent writes.

## Access verification

The rules in this section hold from slice 0.6 of the client state model.

Access is verified by REST alone. A round reads `user/info`, every organization's project list and
each listed project, four projects at a time. Inventory completeness, interest liveness and receiver
state are not inputs, and from 2.3 a round re-reads no inventory. At most one round runs at a time;
its deadline is 30 s plus 15 s for every four projects.

Evidence is stamped when the round's first request is sent, on both the wall clock and the monotonic
clock. Authority ends 15 minutes after its stamp on whichever clock reaches that first. A wall clock
set back by more than 60 s counts as a lapse and starts a round at once. A round whose result
arrives after its own deadline, as in a tab frozen mid-round, is discarded and a new round starts.
The deadline is checked whenever a write or an action is admitted and on every wake, hidden or
visible.

Admission is per project. The account is admitted when `user/info` and every organization list
answer; only their failure fails a round. Each project's authority rests on its own evidence stamp.
A project whose read fails transiently keeps its older evidence until that evidence's own deadline;
after it, the project's content is withheld and its writes are closed until a per-project retry
(10, 20, 40, 60 s) succeeds. The account stays admitted and other projects are untouched. A 403 or
404 on a project's read closes that project's writes at once, even mid-round; its content is
withheld, and removed only after a direct read of the same project at least 5 s later confirms the
answer. A lowered role in an admitted round applies at once.

Renewal is due at the stamp plus 15 minutes minus a lead of at least 3 minutes, widened to 60 s plus
the epoch's 95th-percentile round duration plus 30 s when rounds are slower. A renewal never closes
a write the held evidence still covers: writes stay open until the old deadline. A failed renewal
retries at 10, 20, 40 and 60 s within that deadline. While lapsed, a visible tab starts a round at
once on wake, then retries at 2, 5, 15, 30 and 60 s. A tab hidden for 60 minutes stops renewing; its
grant lapses at the deadline, and its next wake starts a round before anything else that needs
access.

## Server door and compatibility

The client reaches a Mate only through the throwaway door
([spec §10.4](../../../../zcp/docs/spec-mate.md#104-the-door-post-apiauthzerops-throwaway)): it
mints a rights-less integration token as the person, presents it once, and deletes it whether the
door admitted or refused. The client checks no organization or project role for the mint; the door
and the broker decide roles. From 0.7 the mint waits up to 30 s for the account's verification
window instead of failing, and the delete carries the minting token, never the current session, with
its own 15 s timeout and outside the exchange's cancellation, so it can neither run under another
account nor end anyone's session. A token it could not delete is removed by the same account's next
sweep.

`packages/client-runtime/src/zerops/serverCompatibility.ts` defines the GUI's minimum supported
server version, currently 0.11.0, the first server whose only door is the throwaway one,
independently of its own release version. The hosted client's floor never exceeds the Mate version
the fork's published release manifest serves (`stable.json`, spec §2.1c), the version a container
restart installs; a floor is raised only after the release carrying that version is published as
the latest one. Raise the minimum only with a documented mandatory protocol change, compatibility
evidence and within that rule. The descriptor must identify the expected project before a credential
is transmitted. A known version below the floor blocks identity exchange. Unrecognized development
versions are not presumed incompatible; the normal descriptor and identity protocol must succeed.
The optional `accountLifecycleVersion: 1` describes the new server semantics; its absence is not a
connection blocker. The project list displays the server-reported version, and an upgrade error
shows both the actual and required versions. Every floor verdict, including whether a restart helps
because the descriptor's `update.latest` reaches the floor (from 0.9a), comes from that module, the
client's one version comparison (spec MU-1). Restart recovery uses the same minimum. Servers below
0.11.0 have no throwaway door and must be upgraded before the current hosted GUI connects.

On the supported server, the door's grant is exchanged at `/oauth/token`; that short internal grant
is not a manual pairing flow. Only grants from the Zerops throwaway door are accepted in a Zerops
environment. Sessions use the `zerops-user:<id>` subject namespace, rejecting historical manually
issued sessions.

Manual browser-session/pairing HTTP endpoints and the `pair`/`auth` CLI groups are removed. Session
cookies are not credentials for Mate HTTP or WebSocket access. `POST /api/auth/logout` revokes the
calling session without administrative scopes. Independent sessions are not replaced merely
because they belong to the same user.

A session holds no credential of the person's and has no membership window. The server re-reads the
organization's member list and the project's `userRoles` with its own key every
`T3CODE_ZEROPS_ROLE_RECHECK_SECONDS` (default 300 s, clamped to at most 300 s from S.0) and ends
every session whose answer is no longer open. One failed pass changes nothing; a second consecutive
failure ends every Zerops session. A session older than 24 hours ends regardless. Ending a session
closes its sockets, and the client opens a new one with a fresh throwaway (on every rejection, with
backoff, from 0.9b). The client's credential renewer (`credentialRenewal.ts`) is reserved for a door
that re-presents a credential; the throwaway door does not, so nothing renews a Zerops session.

The released surface is hosted web. Desktop uses the same account boundary. Mobile is not released;
its retained entry directs users to hosted Mate, so dormant native connection source cannot become
a pairing escape hatch. A native release requires its own complete account lifecycle implementation.

No database migration deletes history or provider credentials. Old local development records may
remain on disk, but are not part of the signed-in product. Cleanup must use a backed-up, explicit
disposable data directory, never an active developer installation.
