# Zerops account lifecycle

The hosted client has one account boundary, outside the router and connection runtime. Only the
Zerops callback can run before verification. A saved credential is not verification: Mate checks
`user/info` before mounting the product. Navigation reads the selected organization's projects
and services once. A drawn Mate row holds its project detail only when it decides access for a
viewer without organization listing rights (`useVisibleProjectAccess`). Drawing a Mate never
connects to it. Registration and second factors belong to the Zerops account application.

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

Project activity for deployment projections shares the account environment's active detail demand
(route, screen, or explicit action). A cached sidebar row does not hold a project receiver. This
keeps navigation from exhausting the data runtime's receiver budget before a cold Mate opens.
A refused inventory acquisition is retained as a visible failure until manual **Again**, or until
that project's demand ends. It is not retried by a timer.

The hosted web and desktop wrapper use this presentation. Mobile has no global project-flow
provider and therefore no corresponding background receiver sweep; its retained source uses the
same shared acquisition state. Native presentation of that refusal is deferred while mobile is
unreleased by this fork.

## Restoration and convergence

Only stable project/service targets remembered by the same account can reconnect automatically.
Every restoration validates them against the current inventory. A sign-in lands once: on the deep
link it started from, else on the projects page; no route from an earlier visit is restored
(2026-10-02). The server descriptor must identify the expected project before a credential is sent.
Restoration never provisions a missing container. A missing target is unavailable; it does not fall
back to another project's conversation. Drafts retain their environment/thread keys and are not
moved to a replacement environment or sent automatically.

Server snapshots are held in memory for the current login. Historical, unowned connection catalogs
and snapshots are not imported. A login/reload downloads current server state. On socket
replacement, the existing shared shell/thread synchronizers reload authoritative snapshots; thread
history epochs prevent older pages from merging across a history replacement. This deliberately
trades warm offline startup for a smaller, verifiable ownership model.

A Mate's session is kept per account (`keptSessions.ts`, 2026-10-02). A later load presents it again
only where the door would present a fresh one — the Mate's descriptor names the expected project
and the environment it was kept for — and only once the Mate answers that it still holds it with
every scope the client asks for now (`GET /api/auth/session`, 3 s). A session the Mate ended, or one
short of a scope, is forgotten, and a throwaway opens a new one; a kept session spends no mint and
waits on no mint pace. No kept session outlives its login: the account's close ends every one at
its Mate however the account closes, a stored login the platform refuses ends every one the origin
holds, and a session displaced from the store is ended too. HQ's session is kept by the same store
and rules, per account, organization and HQ (K7): a load presents a live one through no door, one
HQ no longer takes is forgotten, and the account's close revokes each at its HQ
(`DELETE /api/session`).

One inventory supplies overview, sidebar and restore. Direct platform lists and permission-filtered
search are paginated; malformed pages, changing totals and duplicate pages fail the read. Reads use
bounded concurrency. Push, focus, reconnect, confirmed local changes and a visible-tab interval
refresh the inventory. Confirmed deletion/access loss removes a target even when another organization fails. A failed
organization read retains only that scope’s last verified list; successful scopes still converge.
Until 0.6, an incomplete access check conservatively disables mutations and offers retry; the
per-project admission below replaces it. Stale content is hidden after the verification window; an
initial failure never unlocks cached product content.

HQ's structure carries each application's `contents`: `empty` uses the same held-record predicate
as app deletion; `deletingProjectIds` names held projects deleting or absent in HQ's Zerops view.
Removing a project from the visible inventory does not establish app emptiness. The product deletion follows Zerops's process stream, then calls HQ's `POST
/api/projects/:projectId/deleted` once. HQ checks that id (`goneOf`), refuses it if it still exists,
and releases its rows and overview in the request, publishing the structure change. Before the
Zerops delete, `POST /api/projects/:projectId/deletion` authorizes the project's admin by the
existing `edit_mate_record` rule and returns an opaque completion handle. HQ seals it with its
existing key, bound to the user, project and deletion purpose; completion still requires active
org membership. It carries no copied platform roles and remains verifiable after the project and
its roles disappear. A failure stays in the dialog with a manual Again, which repeats only the
unfinished completion or key retirement. The periodic reconcile remains for external deletions. Clients use
only a current stream answer for Delete, and keep unfinished deletion visible until that answer
changes. These fields add no stored copy of Zerops topology and no client timer.

Platform writes are not automatically replayed after network loss. An ambiguous response is shown
as uncertain, with instructions to inspect the current project/services. The new-project wizard
cannot immediately create a second project from that uncertain attempt. Once project creation
succeeds, a container-import failure is explicitly reported as partial creation. Multi-step
operations check the original session generation before subsequent writes.

## Access verification

The rules in this section hold from slice 0.6 of the
[client state model](client-state-model.md#status-by-phase).

Access is verified by REST alone. A round reads `user/info` (or reuses its recent answer), then
only projects demanded by a route, an explicit action or a drawn Mate through `GET /project/{id}`,
four at a time.
It never enumerates organization project lists. Navigation and inventory completeness are not
admission evidence. The runtime shares the direct project result with access classification,
including `userRoles`, and ingests its platform observations before completing the read. An
unavailable observation from a 403/404 retains that denial kind; it is not a transport failure.
At most one round runs; its deadline is 30 s plus 15 s for every four demanded projects.

Evidence is stamped when the round's first request is sent, on both wall and monotonic clocks.
Authority ends 15 minutes after its stamp on whichever clock reaches that first. A wall clock
set back by more than 60 s counts as a lapse. A result arriving after its own deadline is discarded
and a new round starts. Every write/action admission and wake checks the absolute deadline.

The account is admitted by `user/info`; each opened project's content and writes require its own
role and evidence stamp. READ_ONLY can be verified without mutation authority; NO_ACCESS cannot
admit project content. A transient project failure keeps older evidence until its own deadline,
then withholds content and closes writes until a per-project retry (10, 20, 40, 60 s) of the demanded
project succeeds. A 403/404 closes writes immediately and withholds content. One direct read of the
same project at least 5 s later confirms the denial before removal; a confirmation that fails retries
on the same rungs.
A lowered role applies as soon as a round admits it. HQ navigation grants no mutation authority.

Healthy renewal is due before expiry, with a lead of at least 3 minutes, widened for slower rounds.
A running renewal leaves writes open until the old evidence expires. A failed initial round retries
on the session backoff (2, 4, 8, 15, 30, 60 s); a failed renewal at 10, 20, 40 and 60 s within the
held deadline; a lapsed grant at 2, 5, 15, 30 and 60 s. Failed checks retry only in a visible tab:
a visible wake or `online` starts them again at once, from the first rung, and **Try now** does the
same. A malformed answer is definitive: no rung, wake or `online` asks again, only **Try now** does
(the 2026-10-05 rule in `design-decisions.md`). Try now during a round joins it; should that round run out unanswered, the next goes out at
once rather than on the ladder. A tab hidden for 60 minutes stops healthy renewal; its grant still expires on time, and its
visible wake starts a round.

## Server door and compatibility

The client reaches a Mate only through the throwaway door
([spec §10.4](../../../../zcp/docs/spec-mate.md#104-the-door-post-apiauthzerops-throwaway)): it
mints a rights-less integration token as the person, presents it once, and deletes it whether the
door admitted or refused. HQ's door takes the same throwaway, named for HQ's project
(`apps/hq/src/door.ts`). The client makes no Gitea sign-in and mints no throwaway for a broker; its
start-up sweep takes back only its own `mate-door:` throwaways (`zeropsThrowaway.ts`). The client
checks no organization or project role for the mint;
the door it is presented to decides roles. From 2.4 a mint of `NO_ACCESS` with no projects and no
flags is an account write: it runs only after the sign-in's first access grant, and a verification
window that has closed since does not hold it up. Any mint that grants a project stays a project
write and is refused while the window is closed. The delete carries the minting token, never the
current session, with its own 15 s timeout and outside the exchange's cancellation, so it can
neither run under another account nor end anyone's session. A token it could not delete is removed
by the same account's next sweep.

The window guards against a person whose access lapsed acting on the platform past it. Minting a
token with no role, no project grant and no flag while project writes are closed cannot grant
anything: the door it is presented to decides what it opens, re-reading the person's role with
its own key, and refuses a token that carries a grant or a flag. A mint that
grants a project would add authority, so it keeps the window.

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

A dead session is never presented again. The client does not send a bearer within 30 s of its own
deadline (issue time plus `expires_in`, on the client's clock), nor one its Mate already refused:
the link blocks on authentication at once, and a wake, a network change or a retry leaves it there
until the door's new bearer rotates in. A session that merely reached its end reads as reconnecting,
never as a refusal. The refusal's `401` carries `expired: true` for such a session — optional both
ways, so an older client ignores it and an older server never sends it — and the server's
`Rejected authenticated session credential.` line names the session and when it ended, never the
token.

The released surface is hosted web. Desktop uses the same account boundary. Mobile is not released;
its retained entry directs users to hosted Mate, so dormant native connection source cannot become
a pairing escape hatch. A native release requires its own complete account lifecycle implementation.

No database migration deletes history or provider credentials. Old local development records may
remain on disk, but are not part of the signed-in product. Cleanup must use a backed-up, explicit
disposable data directory, never an active developer installation.
