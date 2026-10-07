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
catchup and carries the resulting cursor and `core: { protocol, build? }`. The protocol number
states which navigation facts Core supports; the build identifies the serving Core. The client
compares the declared protocol with its required `HQ_NAVIGATION_PROTOCOL`. An absent, unreadable
or older declaration shows a navigation update notice while retaining readable values.

Navigation app, project, person and nested Mate/person records decode each independent field.
Missing or unreadable fields are unknown (`undefined`), never fabricated defaults or proof of an
empty list. The record's other fields remain usable. A wholly unreadable record preserves its
previous value; explicit removals still govern access and deletion.

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
travel only in navigation; clients never demand variables for Finish setup or the
web connection gate. Container flag/variable surfaces keep their own declared detail demand.
The unreleased native client has no HQ navigation link yet; its explicit on-open close-off check
retains the existing sampled marker read until that client observes HQ.

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

An accepted attention report of a restarted Mate, with a new source environment or epoch,
rotates only that Mate's attention scope journal and sends an atomic `scope-reset`.
The baseline carries the new source epoch and revision (including 0 after 7); subsequent updates
are deltas.
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
`packages/contracts/src/zeropsAttention.ts` (also re-exported as `HqAttentionValue`). Ingest orders by source:
inside one environment a higher epoch (the Mate's start count, saved beside its environment id)
always wins, from whichever link brings it, and a lower one never does. An absent epoch decodes
to zero, the lowest, for containers whose Mate has not counted its starts yet; an equal epoch orders by
incarnation and revision, from the link HQ hears. HQ hears a Mate's newest link that no later run
outranks: once a later epoch is held, a link of an earlier run — still open, or reconnected after a
partition — is passed by for attention and overview alike. Between two environments there is no
order, and only the link HQ hears replaces the value. Corrupt or older frames preserve prior values.
`attentionState` distinguishes
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
