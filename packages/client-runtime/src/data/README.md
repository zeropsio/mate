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
  `detail`, only while demanded and once per owner id); an optional `index` (`name`, `keyOf`); for a
  Zerops family, `zerops` (`entity`, the `membership` and `updates` searches, `decode`, and
  `verifyPath` where leaving must ask "deleted or not yours?");
- export its scope helper (`scopeOf(spec, orgId)`);
- add one line to `FAMILIES`.

The reducer, the store, the registrations and the Zerops adapter pick it up from the list.

**A projection.** Add `projections/<name>.ts` exporting `{ name, keyOf, derive(reads, key),
equals: sameValue }`. `derive` reads keyed facts, memberships, coverage, indexes
(`reads.index(name, key)`), streams and operations, never a table. Components read it through
`store.data.project(projection, key)`; test it with a table of inputs through `readsOfState`.

**An operation kind.** Add `operations/<kind>.ts`: declare its intent
(`interface OperationIntents { readonly "<kind>": … }`) and export `{ kind, executor, reflected }`.
Add one line to `OPERATION_KINDS`, and wire the owner's executor into
`makeOperations({ executors })`.

**A source adapter.** Return `{ key, scopes, attempt }`. An attempt opens the connection, starts
reading before it registers anything, registers each scope, commits each answer as that scope's
baseline, and ends only by failing with a classified fault. Run it under
`superviseLink({ ...link, store, repairSession })`. The supervisor alone decides what follows.

## Rules

- Every connection and every scope runs the one stream machine. Its phase is a readable fact; no
  screen infers "loading" from missing data.
- An adapter only classifies a failure. Retry, backoff, session repair and refusal belong to the
  machine and the supervisor.
- A definitive refusal is final until the person tries again or an input changes. Focus, remount,
  socket rotation and time do not revive it. A refused link refuses its scopes.
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
- An operation is recorded before it is sent. A lost answer is asked about by the original id and
  never sent again blindly. Its end comes from its owner, never from a clock. A watch that runs
  out is unresolved and names who acts next.
- Source data lives in memory only, never in browser storage.
- Facts about a person — role, may write, unseen — are computed by HQ, not here.

## Still shared between slices

- **HQ families** are written by the thin adapter over today's structure stream (`adapters/hq.ts`,
  `onEvent`). Until the scoped HQ protocol replaces it, slices that add HQ families edit that one
  function. Run them one after another.
- **A new revision kind** edits `Revision` and `Delivery` in `model.ts` and `supersedes` in
  `reducer.ts`.
- **Detail demand** is declared per family and planned by `zeropsRegistrations`. The Zerops adapter
  registers navigation on each attempt; registering and releasing details while live comes with the
  first detail family.
