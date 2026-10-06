# Client data layer

One path from a source to the screen: **adapter → reducer → store → projection → component**.
Adapters translate and classify; the reducer is the only writer; the store publishes each changed
key to its own atom; a projection is a small pure function one surface reads. Components read
projections only. They never fetch, poll or open a socket.

## Adding to it

The two registry lists are the only shared files a slice appends to:
`families/index.ts` (`FAMILIES`) and `operations/kinds.ts` (`OPERATION_KINDS`). Both refuse a
duplicate family, scope name, index name or operation kind when the layer loads.

**A fact family.** Add `families/<name>.ts`:

- declare its value: `declare module "../model.ts" { interface FamilyValues { readonly <name>: Value } }`;
- export a `FamilySpec`: its owner (`authority`); its one listing scope (`source`, `suffix`, what
  `leaving` the scope means, and `demand` — `navigation`, always and once per organization, or
  `detail`, only while demanded and once per owner id); optional `indexes` (each a `name` and a `keyOf`); for a
  Zerops family, `zerops` (`entity`, the `membership` and `updates` searches, `decode`, and
  `verifyPath` where leaving must ask "deleted or not yours?");
- for an HQ family, `hq` (`scope`, `idOf`, `keyOf`, `decode`, and `wireScope` where it demands a
  scope of its own). A family HQ only relays declares `revisionOf` — its author's revision, read
  with what HQ says beside the value (whether its author is live), which the reducer compares with
  the same value arriving straight from the author — and no `wireScope`:
  it rides the scope another family demands for the same kind (`mateAttention` beside `hqMate`);
- for a source without realtime, `sampled` instead of `zerops` (its scope's `demand` is `detail`):
  the `path` read whole for one owner — a `GET`, or with a `search` a `POST` of it, so only the
  rows asked travel — a `decode` that keeps only what a screen needs, and `freshMs`. Its one fact
  is keyed by the owner; its stream runs in sampled mode — read again every
  `STREAM_POLICY.sampledIntervalMs` while demanded, on a new demand once older than `freshMs`, and
  at once after our own write (`revalidate`) — or, with `freshMs: null`, in `once` mode: read once,
  again only on our write or the person's again. Never claimed live. A flow awaiting one
  (`readDetail`) gets "no answer" at once while the link is down or refused, never a wait;
- export its scope helper (`scopeOf(spec, orgId)`);
- add one line to `FAMILIES`.

The reducer, the store, the registrations and the Zerops adapter pick it up from the list.

**A projection.** Add `projections/<name>.ts` exporting `{ name, keyOf, derive(reads, key),
equals: sameValue }`. `derive` reads keyed facts, memberships, coverage, indexes
(`reads.index(name, key)`), streams and operations, never a table. Components read it through
`store.data.project(projection, key)`; test it with a table of inputs through `readsOfState`.

**An operation kind.** Add `operations/<kind>.ts`: declare its intent
(`interface OperationIntents { readonly "<kind>": … }`) and export `{ kind, executor,
reflected(read, intent, receipt) }`, plus, where they apply, `settledBy(read, intent, receipt)` —
how the owner's facts end it (a process row going terminal) — and `effectHandles(read, intent)` —
the handles in its facts that would show it began (for an owner that keeps no request ids; after a
lost answer only one absent at the send and held by no other operation is adopted) — and
`observedIn(intent, receipt)` — the detail holding its handle (a project's process history), which
`observeAccount` holds as a standing demand from acceptance until the operation settles. Add one
line to
`OPERATION_KINDS`. Wire the owner's executor into `makeOperations({ executors })`: `submit`, and
whichever of `lookup(requestId)` (HQ) and `lookupHandle(handle)` the owner answers. The executor
lives in `operations/executors/`, the one place besides `adapters/` that may reach a remote; the
kind itself runs inside projections and stays pure. Where a step's end can no longer be observed
(a stop ran, then the link paused), `submit` — like a lookup — answers `{ unobservable: { nextActor,
nextAction, handles } }`: the operation ends unresolved with that named next step ("Start the
Mate"), and nothing further is sent blindly.

**Mounting.** An app makes one store per account (`makeAccountStore`) and starts the active
organization's navigation with `startZeropsNavigation`, over `makeZeropsWire` (today's receiver
socket and REST client) and `repairZeropsSession` (today's refresh). All of it comes through the
`@t3tools/client-runtime/data` entry.

**A source adapter.** Return `{ key, scopes, attempt }`. An attempt opens the connection, starts
reading before it registers anything, registers each scope, commits each answer as that scope's
baseline, and ends only by failing with a classified fault. Run it under
`superviseLink({ ...link, store, repairSession })`. The supervisor alone decides what follows.

## Rules

- Every connection and every scope runs the one stream machine. Its phase is a readable fact; no
  screen infers "loading" from missing data.
- An adapter only classifies a failure. Retry, backoff, session repair and refusal belong to the
  machine and the supervisor. A read beside a live link (a detail, a row by id) that fails
  transiently is retried alone on the same policy (`retryDelayMs`, `Retry-After` a floor): the link
  and its registrations stay.
- A definitive refusal is final until the person tries again or an input changes. Focus, remount,
  socket rotation, a link's next attempt and time do not revive it. A refused link refuses its
  scopes.
- Every wait has a deadline or a named next action.
- One family, one reducer, one writer. An operation's receipts go through the same reducer.
- A transport event never deletes a fact. Leaving a scope changes membership, never existence;
  only the owner's proof deletes. A denial withholds and purges, and claims no deletion.
- Revisions compare only within their owner's ordering. A newer value wins. Arrival order and
  clocks never decide.
- A baseline commits atomically. Changes that arrive while it is read are replayed after it.
  Input from a superseded registration is fenced out.
- A damaged row is refused alone. Its member and last value stay.
- Projections are pure and read keyed facts only. A change recomputes only the projections that
  read it.
- Navigation never starts a detail read. Detail is registered only while demanded.
- An operation is recorded before it is sent. A lost answer is resolved by the owner — by a known
  handle, by the original id where the owner keeps ids, else by its facts showing the effect — and
  never sent again blindly. Its end comes from the owner's receipt or its facts, never from a
  clock. It is unresolved only when its owner says it can no longer observe it, naming who acts
  next; an accepted operation holds the detail that shows its end until it settles.
- Source data lives in memory only, never in browser storage.
- Facts about a person — role, may write, unseen — are computed by HQ, not here.

## Still shared between slices

- **HQ families** come with the HQ slice's thin adapter over today's structure stream (`onEvent`).
  Until the scoped HQ protocol replaces it, slices that add HQ families edit that one function.
  Run them one after another.
- **A new revision kind** edits `Revision` and `Delivery` in `model.ts` and `supersedes` in
  `reducer.ts`.
- **Detail demand** is declared per family: a detail family's own scope (`demand: "detail"`,
  registered per owner by `zeropsRegistrations`), or a family's `details` listing (one read is its
  baseline; its members' later changes arrive through the family's own updates). A screen holds a
  detail through `demandDetail({ family, listing?, ownerId })` while it is drawn and releases it on
  unmount; the Zerops adapter reads each demanded listing once per attempt — never one refused —
  and again when its own retry comes due, and the supervisor treats demanded details as children
  of the link. Registering and releasing a detail family's
  own pair while live comes with the first such family.
