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
the keys the renderer retains in that scope. Retained keys allow HQ to prove removals after Core
restart or journal eviction. A cursor without `knownKeys` fails request decoding. An unchanged
resume sends only `scope-ready`. A retained history sends later `scope-values`; otherwise HQ sends
one `scope-reset` for that scope. A reset replaces the revision baseline, not the entire facts map.

Commit a delivery's values and explicit removals atomically. Replace the value at each supplied
key; remove only keys listed in `removals`, whose reason is `deleted` or `no-access`. Omitted or
corrupt values preserve previous facts, including during a reset. Do not infer deletion from
socket closure, silence, an error or a missing key. After a reset accept its incarnation/revision;
after a delta require the same incarnation and the next revision. `scope-ready` marks the end of
catchup and carries the resulting cursor; it carries no facts.

A `scope-error` affects only its named scope. `refused` is definitive until new authoritative
source facts grant access; reconnect alone does not retry the refused read. `transient` preserves
facts while coverage is unavailable. Before an access refusal HQ explicitly removes retained
protected keys. Protected historical values are never replayed through an access revocation.

The L7 segment still closes with `HQ_STREAM_SEGMENT_CLOSE` after 100 seconds. Mint a new ticket
and resume the demanded scopes with their cursors and retained keys. Respond to `ping` with `pong`.
Segment rotation triggers neither a full snapshot nor app detail hydration.

## Record keys

| Scope      | Keys and values                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| navigation | `org`: organization offers, unheld project offers, tools, official verdict, build, health parts; `app:<id>`: `HqNavigationApp`; `project:<id>`: `HqNavigationProject`; `press:<id>`: press state without ticking elapsed time; `person:<userId>`: name and clientUserId |
| app-detail | `releases`, `repos`, `recipe:mate`, `recipe:stage`, `recipe:production`, `changes`; decode each using `HqAppDetailFields`                                                                                                                                               |
| change     | `<repo>:<number>`: existing change detail value                                                                                                                                                                                                                         |
| discussion | `<repo>:<number>`: `{ comments }`                                                                                                                                                                                                                                       |
| attention  | `<projectId>`: `HqAttentionScopeValue`, including presence, today's overview and source attention                                                                                                                                                                       |
| operation  | `<appId>:<operationId>`: values supplied by the operation reader                                                                                                                                                                                                        |

Navigation has no recipes, repositories, releases or move destinations. Project `person` facts
are already computed for the recipient: role, mayWrite, mine and unseen. Mine uses a project OWNER
when present, otherwise the current or last Claude signer, then the Codex signer. Unseen is null
until source attention proves result identities and the person may observe the Mate. `seen` takes
`projectId` and result IDs (attention result `turnId`); HQ accepts only currently published IDs,
stores acknowledgement by person/project/result, and updates only that person's navigation.
Acknowledgements survive Core restart. A missing source attention report does not mean zero unseen.

Send `move-offers` with `requestId` and `projectId` when the move dialog opens. The correlated reply
is `move-offers` with `moveTo`, or `move-offers-error`. Destination enumeration runs only on request;
the eventual write still checks current permissions.

## Shared computation and integration seams

A Core reads one repeatable PostgreSQL snapshot of raw navigation records and shares it between
subscribers. Recipient filtering happens afterward. Detail reads are shared by scope after access
checks, and never hold the navigation lock. Source and per-scope generations discard reads
superseded by invalidations or permission changes. Inactive journals, detail caches, history and
tombstones are bounded. Dropping old removal proof rotates only that scope's incarnation; delivery
still contains every newly removed key, and reconnect retained keys reconstruct missing proof.

Today's overview frames continue to ingest. New Mate frames have
`{ type: "attention", attention: HqAttentionValue }`. Ingest fences the current link and source
incarnation/revision; corrupt or older frames preserve prior values. `attentionState` distinguishes
live, stored and absent evidence. Overview persists as before; source attention must be republished
after Core restart. PB's structural attention schema matches AREV's
`packages/contracts/src/zeropsAttention.ts`; integration should use that canonical schema once the
AREV lane is present in this branch.

PC binds `HqOperationReader` with `read(userId, appId)` returning keyed operation values.
Until bound, an operation scope answers a refused `unsupported` error with
`operation_reader_not_installed`; it does not manufacture an empty result or delete retained keys.
PB checks `read_change` access to the app before invoking the reader. PC supplies the operation
records from `Deploys.operations(appId)`; bind the reader at integration and key records by
`<appId>:<operationId>`. PC must authorize any narrower operation-specific facts within that read. Future explicit operation
removals should extend the reader result rather than treating omission as deletion.
