# Client data layer

This is the change contract for agents working on the client. Since Mate 0.14.26 the client data
layer is the only data path; the old Zerops runtime is removed. Follow this model for new work.
The implementation recipe lives in
[`packages/client-runtime/src/data/README.md`](../../../packages/client-runtime/src/data/README.md).

## Why one layer

Separate fetches, caches and recovery loops make the same fact disagree between screens. They
also make navigation expensive, erase known values during outages and turn guesses into verdicts.
The client needs one path from remote evidence to a surface:

**adapter → reducer → account store → projection → component**

Zerops owns platform facts and permissions; HQ owns application structure, changes, releases and
the operations it accepts; Mate owns conversations and agent activity. A cache grants no access,
and a write is authorized again by its owner. Provider events reach owned product code through
the [provider runtime SPI](spi.md), not through client knowledge of individual provider drivers.

The rules are:

- Show what the source proved. Unknown, stale, partial and refused are distinct states. Missing
  data is not proof of loading, deletion, failure or success. A cold menu shows a skeleton.
- Keep source data in the account's memory, never in browser storage. Preferences, drafts and
  sign-in state have separate contracts; they cannot restore remote facts or verdicts.
- HQ computes person facts: role, may-write, Mine, ownership, waits-on-viewer and unseen results.
  The client reads these facts rather than deriving them from membership lists or saved signers.
- Use realtime and explicit demand rather than fixed-interval polling for live facts. Sources
  without realtime use the layer's declared sampled policy and never claim to be live.
- Preserve known values during transient outages and mark their coverage stale. Unverified access
  withholds protected values; authoritative denial purges affected data without claiming deletion.

## Shape and lifecycle

`packages/client-runtime/src/data` owns the common stream machine, supervisor, reducer, keyed
account store, family registry, projections and operations. Consumers use the
`@t3tools/client-runtime/data` entry. Web and mobile share the model; desktop uses the web surface.
The existing Mate conversation snapshot and sequence replay remain their own sanctioned transport.

There is one `makeAccountStore` per account. Facts are keyed by domain id within their family,
not by the transport that delivered them. Value, authority, source revision, membership, coverage,
freshness and access are separate information. The reducer is the only writer, including for
operation receipts. Keyed atoms and dependencies update only the projections that read a change.
Screens do not subscribe to whole tables.

Every connection and logical scope runs the common stream machine. Its phases include connecting,
baselining, live, stale, recovering, reauthenticating, paused, refused, unsupported and closed.
A healthy socket does not prove its scopes are current. Every wait has a deadline or a named next
action. An adapter classifies failures; the supervisor owns retry, capped backoff, session repair
and refusal. Transient reads can retry without restarting an otherwise healthy link.

A definitive refusal ends the attempt until an input or permission changes or the person explicitly
retries. Focus, remount, socket rotation and elapsed time cannot revive it. Baselines commit
atomically, buffered newer changes apply afterward, and obsolete attempts are fenced out. A damaged
row preserves its previous value and refuses only the affected read. Transport events never delete
facts; only owner evidence does.

`families/index.ts` registers `FAMILIES`. A family declares its value, authority, listing scope,
membership semantics, demand, decoding and optional indexes. Navigation is observed once per
organization; detail is observed only while demanded for its owner. Registration and store behavior
come from that declaration rather than from separate screen-specific fetch loops.

`observeAccount` holds the active organization, its HQ link and outstanding detail demand:

- `demandDetail({ family, listing?, ownerId })` holds a detail while a surface needs it and returns
  a release function. Release on unmount or when the detail closes. Multiple holders share demand.
- `readDetail(...)` holds a detail until its read settles, then releases it. A flow receives no
  answer promptly when there is no usable link; it must not wait indefinitely for reconnection.
- `revalidate(...)` requests fresh sampled evidence after our own write; `retryDetail(...)` is an
  explicit retry. Navigation must never hydrate detail to fill a menu row.

For a source without realtime, declare a sampled family with its path, optional search, decoder
and freshness policy. Reads happen on demand, on revalidation after our write and, where declared,
on the shared sampling cadence while demanded. A once-only policy reads again only after a write
or explicit retry. This is an honest sample, not a substitute live stream or a component timer.

Projections in `data/projections` are small pure functions for a surface: a menu row, release chip,
review or connection page. They join keyed facts and derive the visible state from coverage,
streams, access and operations. Surfaces read projections only; they express demand and submit
intents through the layer, without fetching, opening sockets or keeping another verdict cache.

## Operations and receipts

An operation is recorded before sending its intent. Its receipt carries identity, executor,
affected facts, handles and evidence. Acceptance, reflection in a scope and completion are separate
states. Current platform state, an operation's retained completion evidence and an agent's completed
turn are separate truths.

Each pure kind in `data/operations/<kind>.ts` declares:

- `reflected(read, intent, receipt)`: whether the receipt's effect is visible in the owner's facts.
- `settledBy(read, intent, receipt)`: where applicable, owner evidence that ends the operation.
- `effectHandles(read, intent)`: evidence for adopting an effect after an uncertain answer when
  the owner does not retain request ids. Adopt only a new, uniquely attributable handle.
- `observedIn(intent, receipt)`: the detail that must remain demanded from acceptance to settlement,
  even after the originating surface closes.

Register kinds in `operations/kinds.ts` (`OPERATION_KINDS`). Executors live only under
`data/operations/executors`, including Zerops and HQ executors. They submit and look up the original
request id or handle as supported by the owner. Kind predicates stay pure; adapters and executors
are the remote I/O boundary.

Before HQ exists, its setup runs as a Zerops operation with child writes and observation demand.
Its append-only journal stays in HQ's project environment for recovery across browsers; the gate
reads progress from operation receipts. Mate registration receipts likewise retain a refusal and
its reason after the originating press ends, until a later registration replaces that verdict.

A lost answer is resolved from the original id, handle or proven effect, never by blindly sending
again. HQ retains operation evidence across client reconnects and tab closure. A process disappearing
from a running list does not prove its outcome. Timers may bound observation but cannot invent a
failure or success. If the owner can no longer observe the end, show an unresolved receipt with
the next actor and action.

## Zerops realtime contract

Organization-wide registrations are filtered by Zerops for the credential's permitted projects,
both in baseline responses and pushes. Navigation must use these registrations rather than reading
every project's inventory separately. The core families are projects, processes, services and
active versions; each uses a membership and an entity-update registration.

- `listStream` provides the registration baseline and membership additions/removals.
- `updateStream` provides whole entity rows ordered by `_version`. Register updates before taking
  membership baselines so racing changes are buffered. Membership and entity updates can arrive
  in either order.
- Running-process membership pairs with updates for all process states. Filtering updates to
  running processes loses terminal evidence and leaves indicators running forever.
- Deletion notifications arrive only through `listStream`, never `updateStream`. Leaving a
  filtered list is not necessarily entity deletion; verify deletion versus lost access before
  tombstoning. Likewise, leaving ACTIVE-version membership can mean replacement by a newer version.
- There is no replay after a disconnect. Re-register demanded scopes for a fresh baseline.
  Intermediate states during the gap are unavailable; operation owners retain outcome evidence.
- A socket can stay open and answer pings after access or token revocation. A `401` or `403` from
  a REST read or registration is revocation evidence: end the affected attempt, withhold/purge
  affected account or project data and enter session/access recovery. Re-register after permission
  changes; do not wait for every family to emit removals. A pong proves transport, not authorization.

Detail registrations and sampled reads are additional demand, not work performed for every menu
entry. A direct current-state read must not wait for realtime setup.

Public HTTP routings use one additional organization-wide membership/update pair. Addresses are
joined with services by id; a routing must be synced before its address becomes a link. A service
switch without that routing means publication is pending. A routing leaving membership removes its
address without claiming entity deletion. If the organization routing search is refused to a
viewer who can read individual projects, only that scope is refused. A visible project then demands
its filtered pair; if that search is also refused, its GET listing is refreshed by service-switch
or terminal routing-process evidence. Receiver rotation and elapsed time never repeat a refused
search. Partial answers retain previously read addresses while reporting incomplete coverage.

## HQ scopes

The full wire contract is [HQ scopes and revisions](hq-scopes.md). One socket serves each renderer
and organization. Scopes are navigation, app-detail, change, discussion, operation and attention.
Navigation carries compact menu and person facts; releases, recipes, repositories and other detail
are demanded independently. Each scope has its own incarnation and monotonically increasing revision.

On reconnect, subscribe with the last committed cursor `{ incarnation, revision }` and `knownKeys`.
HQ sends retained deltas or resets only that scope; `scope-ready` ends catchup. Commit values and
explicit removals atomically. Removals distinguish `deleted` from `no-access`; omission or corruption
preserves previous facts, including during resets. A reset establishes a new revision baseline;
a delta requires the same incarnation and the next revision.

Scope errors affect that scope. Transient errors preserve facts with unavailable coverage; refused
scopes need an input/access change or explicit `retry`. Segment rotation resumes scopes rather than
fetching a full structure snapshot or hydrating application detail. Session expiry enters session
repair; an outage must not masquerade as sign-out or a retryable source refusal.

`move-offers`, `handover-candidates` and `compare` are correlated request/reply exchanges when the
person opens the relevant surface. They are not eagerly enumerated for navigation. HQ checks
recipient access, replies only to the requester and retains the refusal/transient distinction.
The eventual write still checks current permissions.

## Mate attention ordering

Mate attention is one source-owned value: environment identity, start epoch, incarnation, revision,
chat identities, working/waiting counts, result/question identities and truncation. A new chat
raises the revision even when counts stay unchanged. The open Mate's direct value and HQ's relay
feed the same family and reducer.

Within one environment, the persisted start epoch increases on each server start. A higher epoch
wins over an earlier run regardless of arrival path or live/stored status. Within the same epoch
and incarnation, the higher revision wins. An absent epoch decodes to zero, below every counted
start, so a container awaiting its Mate update still participates in the same ordering. A
conflicting incarnation is not ordered by its string
or receipt time. Distinct environment identities have no comparable epoch; a live source is needed
to establish replacement. HQ's scope cursor orders delivery, not Mate's source value.

Live and stored describe source evidence separately from ordering. A live client-to-HQ connection
cannot make stored attention live while HQ cannot hear Mate. Older live evidence cannot overwrite
a newer epoch merely because it is live. A direct connection proves freshness only for the source
revision it observed; confirming the retained revision refreshes that evidence without replacing
its value. HQ computes unseen from result identities and per-person
acknowledgements; absent attention means unknown unseen, not zero.

## Guards and proof

The oxlint rules `no-remote-io-outside-data-layer`, `no-remote-data-in-browser-storage` and
`no-retired-mechanism` enforce the boundary and retirement. Their exception ledgers record
remaining migration debt and sanctioned boundaries and only shrink; do not add an exception to build
a new old path. A surviving sanctioned
boundary needs an explicit reason. `scripts/check-guard-exceptions.ts` reconciles ledger entries
against actual findings so deletions cannot leave stale exemptions.

The hosted scenario suite lives in `apps/web/test/scenarios`. It exercises the built client with
real HQ Core and controlled source drivers. Its areas are A sign-in, B menu, C Mate, D changes/review,
E environments/releases, F creation, G outages and H request/render budgets. `fails` marks a known
bug, not acceptable target behavior; remove the marker when the scenario's behavior is fixed.
See its [README](../../../apps/web/test/scenarios/README.md) for running and extending it. Native
mobile and desktop behavior still need a separate surface decision.

## Rules for a change

1. Put new remote reads or subscriptions in `data/adapters`; put remote operation execution in
   `data/operations/executors`. Use the shared stream/supervisor policy rather than a new recovery loop.
2. Add a family in `families/<name>.ts`: declare its value, owner, scope/demand, decoding, membership,
   revision and indexes as needed, then register it in `families/index.ts`. Declare realtime or
   sampled source behavior explicitly. Decide what leaving means and how access/deletion is proved.
3. Add a pure projection in `projections/<name>.ts` with `name`, `keyOf`, `derive` and equality.
   Read keyed facts, memberships, indexes, streams and operations. Test outage, partial coverage,
   refusal and ordering inputs. Move every affected surface to that projection.
4. Add a pure operation kind, register it in `operations/kinds.ts`, wire its executor and define
   reflection, settlement and observation demand. Test uncertain acceptance and recovery from evidence.
5. Follow shared behavior through web, desktop and mobile, shrink the replaced path's guard entries
   and cover the affected scenario area. Run focused checks appropriate to the change.

Never fetch directly in a component or hook, cache remote facts or verdicts in `localStorage`,
use timers to decide outcomes or source precedence, compute person facts in the client, or make
navigation fetch every detail. Do not retain a parallel old path after its replacement is wired.

## Inventory, database and browser results

The inventory presentation reads `inventory` and `inventoryCandidates`, joining retained platform
access with HQ placement and Mate overview labels. Project topology reads `inventoryTopology` for
its services, running work and usage. The web inventory provider publishes these projections;
there is no writable inventory snapshot copied into a second atom. An outage keeps source facts,
partial coverage stays partial, and a denied project is withheld at the read.

Database details are the `database` family. The Mate executor reads services, trees, tables,
counts, query results and mention catalogs on explicit demand; its adapter commits each answer
through the reducer. Each target has the common stream machine, with late answers fenced by the
input generation. Service names and picker, catalog and mention purposes have separate tagged
slots. Closing the last mention demand aborts catalog reads and traversal as well as publication.
A refusal survives remount and adapter recreation until explicit retry or a
changed input. `databaseSession` observes the console process through its own demanded realtime
scope; observing an idle console never starts it. The panel holds only selection and editing state,
and the previous direct database command and catalog cache are removed.

Browser viewport and call results are separate slots in `mateBrowserFrame`. A call slot includes
environment, thread, turn and tool-call identity and compares the source's revision. Only complete
identified evidence replaces a call result; explicit complete absence clears its frame. A viewport
event proves only the call revision it identifies in the current connection session. Retained
frames stay last-known after reconnect until that revision is observed again; running cards withhold
last-known images. A frame without that identity cannot become a call result just because a card is mounted or a call
is active. Older servers omit the identity, so their call slots stay unknown while the live browser
panel still reads the viewport. The optional RPC call-result capability keeps older clients able
to subscribe to the same relay. Account teardown closes demanded adapters before registry disposal.

The three guard ledgers retain only findings whose exact fingerprints still exist. Every surviving
entry explains its retained dependency: 64 remote-I/O findings, 205 retired-mechanism findings and
8 browser-storage findings. The remaining boundaries include account/transport
bootstrap, T3 workspace and conversation state, separate repository and credential protocols,
creation/press/update workflows awaiting their own owner receipts, and unreleased mobile
presentation. The token detector also matches some existing facade names that already read data
projections; those entries identify that distinction explicitly.

The provider/model label and composer change-strip storage entries remain debt in those separate
surfaces. Container-intent entries describe local tab bookkeeping awaiting its declared allowlisted
home; they do not authorize remote verdict storage. These retained entries do not provide a second
inventory, database or browser-call source path.

The old Zerops runtime, query cells, grant driver and second realtime socket are removed. The verified account owns one
Zerops store and transport, with its Mate presentation adapter closed before its registry. Operations
admit each write against the store's current platform-access projection and fence the account again
before sending, including after an awaited source read or session repair. Transport loss retains
access evidence; an authoritative refusal stays final until explicit retry or changed input.

HQ change attachments are the `hqPicture` detail family. A description picture near the viewport demands its immutable
attachment identity; the HQ link reads its bytes through the wire once and publishes the answer
through the reducer. Refusal survives remount and segment rotation until explicit retry. Blob URLs
belong to the mounted view and are revoked when it releases them; bytes remain in account memory.

Build-log transport opening is not evidence that its baseline is read. A valid source frame,
including an explicitly empty frame, ends the initial loading state. Publication batching only
coalesces updates; elapsed time never declares a log live.

HQ review descriptions, commits and linked changes use the `hqChangeRead` detail family on the
account's HQ link. Its owner identity includes the requested change and review snapshot, so another
head demands another read. A settled snapshot remains in account memory through outages and
remounts; only explicit retry or revalidation reads the same identity again.
