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

`HqNavigationPress` retains `heldForMs`, HQ's remaining hold duration at the read, along with
`until`, kind, optional appId and importProcessId. The client can present elapsed time from the
received duration; a clock or transport silence never decides whether the press succeeded or ended.

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
Acknowledgements survive Core restart. They load only for observed projects in the scope, and are
deleted on forgetting a Mate. A synchronous epoch
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

The production Core composition is shared by the running-Core harness. The retired
`test/harness/coreWithDeployTimings.ts` remains deleted. Both distinct `0046_*.sql` migrations
coexist, and guard exceptions are reconciled against the combined source.
