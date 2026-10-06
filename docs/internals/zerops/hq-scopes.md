# HQ scopes and revisions

The hosted client opens one `/api/structure/ws` socket per renderer and organization with the
existing one-use stream ticket. All wire requests and messages are defined in
`packages/shared/src/hqStream.ts`, exported as `@t3tools/shared/hqStream`. The former structure
snapshot, diff, Mate patch and release-revision socket messages are removed. The server and new
client adapter must integrate together; this protocol is not compatible with the former client.

## Subscription and catchup

Send `subscribe` with a `scopes` array of `{ scope, cursor?, knownKeys? }`. Scope identity is given
by `hqScopeKey`. The six kinds are navigation, app-detail, change, discussion, operation and
attention. App detail takes `appId`; change and discussion also take `repo` and `number`; operation takes `appId`,
and attention takes `projectId`. Send `unsubscribe` when demand ends. Each connection allows 128
scopes. Independent scopes have independent incarnations and revisions. Requests run independently,
including scopes in one subscription batch; unsubscribe cancels delivery from an unfinished baseline.

For a reconnect, send the last successfully committed `{ incarnation, revision }` cursor **and**
the keys the renderer retains in that scope. Retained keys let HQ withhold facts after Core restart or journal eviction. Unknown keys receive
`no-access` without revealing whether the id exists. Only server-held prior delivery evidence may
distinguish a deletion from lost access. A cursor without `knownKeys` fails request decoding. An unchanged
resume sends only `scope-ready`. A retained history sends later `scope-values`; otherwise HQ sends
one `scope-reset` for that scope. A reset replaces the revision baseline, not the entire facts map.

Commit a delivery's values and explicit removals atomically. Replace the value at each supplied
key; remove only keys listed in `removals`, whose reason is `deleted` or `no-access`. Omitted or
corrupt values preserve previous facts, including during a reset. Do not infer deletion from
socket closure, silence, an error or a missing key. After a reset accept its incarnation/revision;
after a delta require the same incarnation and the next revision. `scope-ready` marks the end of
catchup and carries the resulting cursor; it carries no facts.

A `scope-error` affects only its named scope. `refused` ends the attempt: timers and a same-session
reconnect do not retry it. A roles or record change clears the refusal and re-evaluates current
access. A newly authorized session also re-evaluates its demanded scopes, including when it follows
a failing old-session read. A person can send `{ type: "retry", scopes: [scope] }` for selected
scopes or `{ type: "retry" }` for all their journals. Retry is scoped to that person. After a `4403`
close, open a new socket and send the explicit retry before subscribing; a transport reconnect alone
is not an explicit retry. `transient` preserves
facts while coverage is unavailable. Before a proven scope access refusal HQ explicitly removes retained
protected keys. A source `zerops_refused` is definitive but proves no record removal. Protected historical values are never replayed through an access revocation.

The L7 segment still closes with `HQ_STREAM_SEGMENT_CLOSE` after 100 seconds. Mint a new ticket
and resume the demanded scopes with their cursors and retained keys. Respond to `ping` with `pong`.
Segment rotation triggers neither a full snapshot nor app detail hydration.

`HQ_STREAM_REFUSED_CLOSE` (`4403`) ends the socket only when every demanded scope has reported
`zerops_refused`, with no usable or pending demanded scope remaining. Scope failures are delivered
before the close; a mixed connection remains open. Client adapters use
`hqStreamCloseFailure` to classify it as `zerops_refused` / `refused`, and must not reconnect it
automatically. A `1011` read failure remains transient. A `4401` ending enters the session flow:
PA renews once automatically before exposing an explicit retry. It is not an unconditional request
to sign in manually. PA's HTTP refusal is `HQ_ZEROPS_REFUSED` (`403 zerops_refused`), whose body is
`HqZeropsRefusedResponse`; it must not follow the `503 zerops_unavailable` retry path.

## Record keys

| Scope      | Keys and values                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| navigation | `org`: organization offers, unheld project offers, tools, build; `status`: `HqNavigationStatus` with official verdict and health parts; `app:<id>`: `HqNavigationApp`; `project:<id>`: `HqNavigationProject`; `press:<id>`: `HqNavigationPress` including hold duration; `person:<userId>`: `HqNavigationPerson` (name, clientUserId, avatarUrl) |
| app-detail | `releases`, `repos`, `recipe:mate`, `recipe:stage`, `recipe:production`, `changes`; decode each using `HqAppDetailFields`                                                                                                                                                                                                                        |
| change     | `<repo>:<number>`: existing change detail value                                                                                                                                                                                                                                                                                                  |
| discussion | `<repo>:<number>`: `{ comments }`                                                                                                                                                                                                                                                                                                                |
| attention  | `<projectId>`: `HqAttentionScopeValue`, including presence, today's overview and source attention                                                                                                                                                                                                                                                |
| operation  | `<appId>:<operationId>`: durable `OperationRecord` values from `Deploys.operations(appId)`                                                                                                                                                                                                                                                       |

Navigation app values include `environments`: stage/production tier, name, sources, order,
deploy key status and offers, bounded jobs with state, evidence and version handles, environment
birth, and production release standing. Decode with `HqNavigationApp` / `HqNavigationEnvironment`.
App `can.add_stage` and `can.add_production` offer the existing create-new-environment flow:
HQ requires project-creation capability (or a structure writer), then evaluates the existing
`attach` rule with held `none` for the prospective creator-owned project and the application's
real projects. This prospective offer is never used as write evidence. A live stage or devstage
occupies the stage slot, and a live production occupies production; missing Zerops projects free
the slot. Occupied slots refuse `slot_taken`, including for a writer; replacing remains a separate
write. Environment `project:<id>.can.finish` independently gives the existing attach decision for
that held project, its stage/production tier and its application's current projects. It is present
even when no environment declaration has been saved yet; a half-made stage occupying the slot can
therefore refuse `add_stage` while allowing an OWNER/ADMIN to finish. This is permission to finish,
not a claim that setup is incomplete; key status and presses retain their own facts. Devstage uses
the stage attach target. Writes still authorize the actual project against fresh Zerops facts.
The existing per-person `read_change` filter applies: environments are `{ refused: reason }` when
that person cannot read application changes. Navigation carries no application release catalog,
recipes, repositories or move destinations; those remain app detail.

Each navigation app carries `releaseOffer`: the recorded recipe head, suggested version, a bounded
summary of changes production has not received, the recipient's release decision and any release
in flight. `null` means not read yet; `{ refused: reason }` withholds it from a person without
`read_change`. HQ reuses the release writer's production recipe interpretation, recorded repository
heads and retained live deploy evidence. It shares candidates across people, filters at delivery,
and revises only affected app values after head, release or deploy changes. Reading candidates runs
outside the navigation baseline lock; menu and project pages demand no app-detail scope for an
offer. Service entries and comparisons load when review opens, and the write still checks current
permission and heads.

Each navigation app also carries `changes`, its compact open menu rows (`HqNavigationChange`):
repo, number, title, mateProjectId, state `open`, updatedAt, mergeability, ready and hasHead.
Repository supplies the code/recipe label and link, Mate identity groups the row and supplies its
author from navigation projects, updatedAt orders rows, mergeability drives the mark, and ready
controls Review alongside the Mate's existing activity facts. hasHead preserves the provider's
first-push filter without transferring a commit SHA. Descriptions, comments, commit contents and
settled changes remain in app-detail/change/discussion scopes. A complete authorized read with no
open changes is `[]`; a person without `read_change` receives `{ refused: reason }`.
Navigation never subscribes to or hydrates application detail to obtain these rows.
`scope-error` retains its `code`, reason and disposition on the wire for worded refusals.

`HqNavigationPress` retains `heldForMs`, HQ's remaining hold duration at the read, along with
`until`, kind, optional appId and importProcessId. The client can present elapsed time from the
received duration; a clock or transport silence never decides whether the press succeeded or ended.

Each project’s `mate` includes `closedOff` and nullable `setupMarker`, the setup press marker’s
presence. HQ reads only `MATE_SETUP_RUNTIMES`, once for a Mate record/service/import input, sharing
the evidence across recipients and filtering with the other Mate records. Reads run outside the
navigation baseline. Until a read answers, the marker remains unknown (`null`); partial, corrupt,
unavailable or refused reads prove no absence. A complete search with no marker is `false`,
including legacy records with no service binding. Record replacement fences old replies; an
import or service binding change allows another read and retains prior usable evidence if the
new read cannot answer. Unchanged
input, reconnect and elapsed time repeat no read, including a definitive refusal. Unknown evidence
can be resolved by the existing Finish setup action or a changed record/import input. Setup facts
travel only in navigation; clients never demand variables for menu rows, Finish setup or the
web connection gate. Container flag/variable surfaces keep their own declared detail demand.
The unreleased native client has no HQ navigation link yet; its explicit on-open close-off check
retains the existing sampled marker read until that client observes HQ. It performs no menu demand.

Project `person` facts are already computed for the recipient: role, mayWrite, mine, ownerUserId,
waitsOnViewer and unseen. `ownerUserId` resolves the project's OWNER to a person; when there is no OWNER grant, it uses the
current or last Claude signer, then Codex; null when none can be resolved. `mine` compares that
owner to the viewer. `waitsOnViewer` compares the preferred agent signer to the viewer independently
of OWNER, using the currently signed-in Claude then Codex person. Each project carries two maps,
keyed by login/agent ID (including custom agents and other logins): `signedInNow` holds the current
person only while the credential is present and is not an API token; `everSignedIn` holds the
latest known person from current sign-in, last sign-in, then saved history. An empty historical map
means HQ knows of no person having signed in yet. Saved or last signers never imply a current login.
Both maps and signer-derived facts are supplied only to people who may observe the Mate; other
readers get empty maps and false waitsOnViewer. Saved signers are not duplicated inside `mate`.
Token identities are excluded. Referenced people carry `avatarUrl` (null when absent), decoded from
Zerops member `user.avatar.smallAvatarUrl`, falling back to `externalAvatarUrl`.
A changed overview updates only that project's facts and referenced person values, without
re-reading structure, roles, recipes or environments. Unseen is null
until source attention proves result identities and the person may observe the Mate. `seen` takes
`projectId` and result IDs (attention result `turnId`); HQ accepts only currently published IDs,
stores acknowledgement by person/project/result, and updates only that person's navigation.
Acknowledgements survive Core restart. Each delivery batches uncached coverage for its observed
projects into one person-filtered SQL read; a targeted update reads only its affected project.
Coverage is cached by person/project and guarded against forget epochs and concurrent acknowledgements.
Acknowledgements are deleted on forgetting a Mate. A synchronous epoch
fences the per-person cache so a recreated Mate cannot inherit an old result acknowledgement. A missing source attention report does not mean zero unseen.

Send `move-offers` with `requestId` and `projectId` when the move dialog opens. The correlated reply
is `move-offers` with `moveTo`, or `move-offers-error`. Destination enumeration runs only on request;
the eventual write still checks current permissions.

Send `handover-candidates` with `requestId` and `projectId` when the handover opens. HQ checks
that the requester is an ACTIVE person with org OWNER/ADMIN role and may observe that Mate,
before returning every ACTIVE org person with userId, clientUserId, name and nullable avatarUrl.
Project access alone is insufficient; other requesters receive a `refused` error without candidates.
Invited/suspended members and integration tokens are excluded. Replies are
`HqHandoverCandidatesMessage` with `candidates`, or
`HqHandoverCandidatesError` with `refused` / `transient`. The reply is correlated and delivered
only to the requesting connection; candidate enumeration is not part of navigation.

Send `{type:"compare", requestId, appId, repo, base?, head}` for an on-demand repository
comparison. `repo` keeps the repository name; `base` and `head` are full commit SHAs. Omitting
`base` reads history through `head`. The private correlated reply is
`{type:"compare", requestId, appId, repo, result: CompareResponse}`: nullable base, head,
commits (SHA, subject, authorName, at, optional landed change), truncated and total, with the
same bounds and ordering as before. It requires no scope subscription and creates no journal.
`Changes.compare` checks this person's `read_change` permission before app/repository existence
or git reads. A person without access gets the same refusal for hidden and unknown apps.
Failures are `{type:"compare-error", requestId, appId, repo, code, reason, disposition}`;
`disposition` is `refused` for denied access, source refusal or missing app/repository/commit,
and `transient` for outages. `code` and nullable `reason` retain the server's explanation.
Replies go only to the requesting connection. The HTTP
`GET /api/apps/:appId/repos/:repo/compare` route is removed; clients use this socket request.

An accepted attention report from a restarted Mate's newest link, with a new source environment
or incarnation, rotates only that Mate's attention scope journal and sends an atomic `scope-reset`.
The baseline carries the new source revision (including 0 after 7); subsequent updates are deltas.
A cursor for the retired scope incarnation gets the current baseline, never retired source history.
The first attention source also establishes a baseline. Older links and stale revisions remain
fenced by ingestion. Navigation receives its separate targeted person/attention fact update.

## Shared computation and integration seams

A Core reads one repeatable PostgreSQL snapshot of raw navigation records and shares it between
subscribers. Recipient filtering happens afterward. Detail reads are shared by scope after access
checks, and never hold the navigation lock. Source and per-scope generations discard reads
superseded by invalidations or permission changes. Inactive journals, detail caches, history and
tombstones are bounded. Idle journals are retained by most recent use, including unsubscribe and
connection close; pong does not scan retention. Attention updates compute only the changed project
for people who may observe it. Deploys and release changes read one shared repeatable snapshot
of environment facts, compare raw per-app fingerprints, and commit only changed `app:<id>` values
to recipients who may read them. They do not rebuild organization navigation, project person facts,
recipes or role views. An unchanged environment event produces no navigation revision or payload.
Status ticks commit only `status`, sharing that value between people
and leaving navigation and role reads untouched. Dropping old removal proof rotates only that scope's incarnation; delivery
still contains every newly removed key, and reconnect retained keys reconstruct missing proof.

Cold navigation reuses the source validated before its load and revalidates before publication;
it does not fetch roles again inside the load. The five-person, 30-Mate cold benchmark enforces
p50 ≤ 60 ms, p95 ≤ 300 ms and at most one coverage query per person. The coverage query budget is
independent of host scheduling, so a per-project query loop cannot hide behind a fast test run.

Today's overview frames continue to ingest. New Mate frames use
`MateLinkUp` attention frames, with the canonical `MateAttention` from
`packages/contracts/src/zeropsAttention.ts` (also re-exported as `HqAttentionValue`). Ingest fences the current link and source
incarnation/revision; corrupt or older frames preserve prior values. `attentionState` distinguishes
live, stored and absent evidence. Overview persists as before; source attention must be republished
after Core restart. The link reader and scope value share that schema; there is no parallel
structural attention codec.

Core provides `hqOperationReaderLayer` to `hqScopesLayer`, binding `HqOperationReader` to
`Deploys.operations(appId)`. The hub checks the recipient's `read_change` access before reading
operations and subscribes to `Deploys.changes` for revisioned updates. Each record is keyed by
`<appId>:<operationId>` and carries its executor, kind, state, original handles, version IDs,
retained evidence, steps and reason (`OperationRecord` in `apps/hq/src/operations.ts`). Successful
and unresolved ends are delivered as values; unresolved evidence names the person and their next
action. Omission never deletes a retained operation. Future explicit removals should extend the
reader result. Isolated scope tests may replace the reader; an unbound reader refuses
`unsupported` / `operation_reader_not_installed` rather than manufacturing an empty result.

`Changes.navigation` reads every open menu row in one compact SQL query, without bodies,
comment counts, git, recipes, repositories or releases. The scope hub shares that source across
people and checks `read_change` at delivery. Change events compare shared per-app fingerprints
and revise only changed app values, preserving other navigation facts. The source generation
fences an in-flight baseline; permission changes fence delivery. Closing or merging a change
replaces that application's complete open-row list. An unchanged event transfers no values.

The production Core composition is shared by the running-Core harness. The retired
`test/harness/coreWithDeployTimings.ts` remains deleted. Both distinct `0046_*.sql` migrations
coexist, and guard exceptions are reconciled against the combined source.

## Connection shutdown

Renderer sockets and Mate links authorize before upgrading. At the lazy reader acquisition,
Core rechecks that the Node TCP stream is still readable and writable. A peer can send FIN
while those authorization reads are in flight; `ws.handleUpgrade` then skips its callback,
leaving the platform's masked acquisition uninterruptible and preventing the served-routes
scope from closing. Core cancels that abandoned request before entering the acquisition.
The check and synchronous Node handshake run in one scheduler turn; subsequent reads use
normal scheduling. No detached production fibers or shutdown timeout hide unfinished work.
The HQ shutdown test keeps a Mate overview link live, closes a subscribed renderer, abandons
the next renderer/Mate upgrade, waits for the server's FIN receipt, and bounds Core stop.
