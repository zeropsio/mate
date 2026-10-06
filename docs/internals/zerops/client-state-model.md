# Client state model

The reference for code that builds on the Mate client's Zerops state: who owns each remote fact,
how a fact reaches a screen, which machines move it, how long it lives, and how change arrives. It
is a sibling of the [live data architecture](platform-data-architecture.md) and its
[consistency contract](platform-data-consistency.md), which remain the rules of the platform data
runtime inside this model. The [account contract](account-lifecycle.md) states what a signed-in
person may see and do; design decisions live in
[spec-mate](../../../../zcp/docs/spec-mate.md). Parts of the model land slice by slice; the
[status table](#status-by-phase) at the end says which rule holds today and which slice makes the
rest true. A row there changes in the commit that changes the fact.

Path prefixes: `cr/` = `packages/client-runtime/src/`, `web/` = `apps/web/src/`.

## Three axes

Three questions stay separate. No expression may answer two of them.

| Axis       | Question               | Owner                                                                            | Changes on                                                                | May never                                            |
| ---------- | ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mounting   | Is this UI alive?      | The account epoch (from its first grant), and a route for its own outlet         | Sign-in, sign-out, principal change, navigation, a terminal route verdict | Depend on data liveness or on the access window      |
| Capability | May I do X now?        | The grant (per project), the Zerops session, the HQ session, the Mate credential | Renewal, denial, session loss                                             | Unmount UI, or erase facts that are not secrets      |
| Freshness  | Is what I see current? | Each fact                                                                        | Pushes, reads, pauses, failures                                           | Turn _known_ back into _unknown_ within one identity |

## Seven laws

1. **One fact, one owner.** Each remote fact has one writer: an account-scoped store in
   `cr/zerops`. Components never copy, time or catch a remote fact.
2. **One knowledge type.** Every remote fact reaches a projection as `Known<T>`. No remote fact is
   `T | undefined`.
3. **Negatives are earned.** "Nothing deployed yet", "No open changes" and "no longer
   available" come only from `known` with complete coverage, or from `gone` with evidence.
4. **Knowledge is monotonic within one identity.** A known value only gains freshness markers. A
   new key is a new fact and never resets its neighbours. Evicting an unleased entry ends its
   identity; a mounted view never sees an eviction.
5. **Capability loss never unmounts and never erases non-secret knowledge.** Withholding is applied
   at the store's public read, per project, so it fails closed. The one erasure: the resource
   broker's retained values (configuration, exports, tokens) are erased at the access deadline.
6. **Pushes invalidate; clocks are backstops.** Invalidations are a closed, typed union that
   carries no data.
7. **Every wait has an exit.** Every non-terminal state holds a `retryAt` or names the user action
   that leaves it. Attempts with side effects (throwaway mints) are rate-bounded per tab.

## Vocabulary

- **Account epoch** — One verified Zerops principal in one renderer (`currentAccountEpoch()`). Opens
  when the session verifies a principal; closes on sign-out, principal change or an
  unrefreshable 401. A result from a closed epoch is dropped by the store that receives it.
- **Pre-grant stage** — Built when the principal is verified: session, grant, data runtime.
- **Post-grant stage** — Built on the epoch's first `granted`: T3 connection runtime, environment,
  container and probe stores, the deployment store, reconcilers.
  Nothing in it runs before the platform has confirmed organizations, projects and roles.
- **Owner record** — `zerops-mate.zerops-session-owner.v1 = {userId, loginGeneration}` beside the
  unchanged session key. Written only by a tab that verified the principal; a refresh never changes
  it. It is the cross-tab epoch.
- **Target key** — A Mate's identity: `projectId:serviceId`. `environmentId` is an attribute learned
  from the descriptor; names, URLs and origins are addresses, never identities.
- **Source** — A system that answers with authority, reached through one adapter: Zerops REST, the
  Zerops datastream, a Mate's descriptor and `/healthz`, a Mate's WebSocket RPC, the organization's
  HQ — its API as the person, through its door, and its structure stream. Storage, visibility, locks
  and clocks are signals, never sources.
- **Observation** — One arrival of evidence (a frame, a response, a descriptor, a close code, a
  storage event), stamped with a local ordinal and receipt time, admitted or rejected by its owner.
  Never rendered directly.
- **Fact** — A typed statement one owner holds about one entity, keyed by its natural identity. A
  key never contains a generation counter, a set of unrelated ids, or the active organization.
- **Store (owner)** — The one module allowed to change a family of facts: a serialized event queue
  feeding a pure `transition(state, event, now) → {state, effects}`, publishing one atom per key.
- **Machine** — The statechart of one entity inside a store: a discriminated union with a total
  transition function. No boolean, ref, attempted-set or epoch counter stands in for a state.
- **Command, attempt** — An intent to change a source. A command never writes a fact: its response
  is an observation plus invalidations, and it is never replayed after a write may have been
  accepted.
- **Capability** — A derived answer to "may this class of command run now": `allowed`, or `no` with
  a typed reason and a `waitable` flag.
- **Grant** — The client's verified authority: account evidence (user, organizations, round stamp)
  and per-project evidence (effective role and mutation flags, each with its own stamp). Authority
  for a project ends 15 minutes after its own stamp.
- **Demand (lease)** — A view's declaration that it shows a key. Drives priority and may start a
  subscription or a backstop. Releasing it never blanks a mounted neighbour.
- **Invalidation** — A typed message that facts under a key may have changed at the source. Carries
  no data.
- **Intent** — A local, time-boxed expectation from our own command ("we asked this Mate to restart
  at T"). It changes how observations are interpreted, survives a reload of its tab, and past its
  budget becomes `overdue`, never another state.
- **Projection, verdict** — A pure function from knowledge, capabilities and `now` to a view model;
  a verdict is a render-ready projection. Neither holds state.
- **Personal context** — Account-scoped, non-secret records in browser storage: registrations,
  intents, drafts, UI preferences. Never authority for existence or access; always
  revalidated against facts.

## The knowledge type

`cr/zerops/knowledge/known.ts` is UI-free and platform-free (design-system R1).

| State     | Carries                                                                  | Means                                                              |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `unread`  | `waitingFor` (a prerequisite, or none)                                   | Nothing read yet. Waiting for a prerequisite is not a failure.     |
| `reading` | since, attempt                                                           | A first read is in flight.                                         |
| `failed`  | failure reason, attempt, `retryAt` (null = user action or input change)  | No value was ever known for this identity.                         |
| `known`   | value, stamp `{ordinal, atMs}`, coverage `complete`/`partial`, freshness | A value, including its domain negatives (`Deployment.none`, `[]`). |
| `gone`    | absence evidence, stamp                                                  | Confirmed absence.                                                 |

`Shown<T>` is `Known<T>` or `withheld(reason, cause)`, the only shape a consumer receives. A store
keeps a `Cell` (held knowledge, access scope, withholding, read and invalidation ordinals, a dirty
flag) private; its public `read` applies withholding, so a surface cannot forget it.

| Part             | Values                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prerequisite     | `zerops-session`, `access-grant`, `mate-session`, `presence`, `visible`, `online`                                                                |
| Failure reason   | `offline`, `timeout`, `transport`, `throttled`, `server(status)`, `unauthorized`, `refused(code, words)`, `malformed`, `unsupported(capability)` |
| Freshness        | `live` (an observing push covers it), `settled` (last pull succeeded, no push), `revalidating`, `paused` (not current), `stale(reason)`          |
| Stale reason     | `source-recovering`, `revalidation-failed(failure, retryAt)`, `invalidated`, `superseded(by)`                                                    |
| Absence evidence | `direct-not-found`, `direct-forbidden`, `complete-scope-omits-verified`, `authoritative-removal`, `removed-by-user`                              |
| Withheld reason  | `access-lapsed`, `access-unverified`, `access-denied`; its cause names the renewal failure and retry time, or none                               |

**Monotonicity.** Model tests check each rule.

- **Order.** Within one identity (key, epoch, residency) `known` never becomes `unread`, `reading`
  or `failed`; it leaves only through `gone`, eviction of an unleased entry, or epoch close. A failed
  revalidation keeps the value as `known(stale)`.
- **Stamps.** A value's ordinal never decreases. A completion older than the applied value is
  recorded as done and its value suppressed.
- **Invalidation beats in-flight reads.** A read that started before an admitted invalidation may
  store its value but not mark it fresh; the key is re-read once after it completes. Nothing aborts
  an in-flight read.
- **Key isolation.** A change to one key never republishes or resets another; aggregates are
  records of per-key cells.
- **Negatives and absence.** A domain negative exists only inside `known` with complete coverage;
  absence only as `gone` with evidence. `gone` reopens only on a direct verified read, never on a
  push or a search membership.
- **Withholding is per scope and never loss.** Withholding and restoring never change the held
  value or its stamp. Authority is restored only to scopes positively present in admitted evidence.
- **Publication is per key.** No owner holds values back to publish unrelated keys together; the
  data runtime's bounded flush batches are transport batching and allowed.
- **The epoch is the only global reset.** An organization switch, a route change, an unmount or a
  capability change never resets knowledge.

**Rendering.** `knownPresentation(shown, surface)` in `cr/zerops/knowledge/presentation.ts` is the
one phrase producer for web and mobile (design-system R5); copy follows the design-system glossary.

| Shown                         | Region shows                                           | Affordance                                     |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `unread`, `reading`           | Placeholder at final height; "Checking…" after 400 ms  | —                                              |
| `unread(waitingFor)`          | Placeholder naming the wait                            | —                                              |
| `failed`                      | Region-level message naming the cause                  | Try again                                      |
| `failed(unsupported)`         | "This Mate is too old for this."                       | Update, only when the descriptor offers one    |
| `known(live or settled)`      | The value, including domain negatives                  | Verbs per capability                           |
| `known(revalidating)`         | The value, unchanged                                   | Verbs allowed                                  |
| `known(paused)`               | The value, marked not current                          | Currency-dependent verbs disabled              |
| `known(stale)`                | The value and a quiet marker                           | Try now; Merge, Release and Roll back disabled |
| `known(partial)`              | The known members, never "none" or a zero count        | —                                              |
| `gone`                        | The authoritative negative                             | Go to projects                                 |
| `withheld(access-lapsed)`     | Placeholder; one app banner per reason, naming a cause | Try now, when a failure is the cause           |
| `withheld(access-unverified)` | Placeholder in that project's rows only                | —                                              |
| `withheld(access-denied)`     | Placeholder                                            | Go to projects                                 |

A failure covers its own region, never a wider one. A message names the cause only; the component
renders its affordance exactly once. A view's readiness is the conjunction of its declared required
facts; optional facts degrade only their own region. Platform data is never presented as current
while its interest is not observing.

## Fact owners

- A Mate's last signer is display knowledge, separate from current login authority. The server
  retains it in `signed-in.json` when the credential goes (`credentialCleared`), omits it from
  `ZeropsProjectSigners.signers`, and relays `lastSignedInBy` beside `signedInBy` in its HQ overview.
  HQ names both through its people stream. The shared owner resolver can keep a badge while
  `signedIn` is false; authentication and turn admission still use only the current signer.

A fact is owned where it is born and where its authority is checked. The Mate server owns what is
born in its container (boot, planned stops, the sessions it issued, its key's verdict, its checkout,
its agent's tool results, agent sign-in and its signer). zcp reaches the client only through the
Mate server. HQ owns the organization's structure — its applications, their projects and kinds, each
Mate's record — a Mate's changes, the environments and their deploy keys, and the releases; it
relays what each Mate's server says of itself. The client owns the person's facts (identity, grant,
its HQ session), facts spanning several Mates as this person reads them (inventory, group flows) and
facts about this browser's path (reachability, probes, this tab's credentials). Zerops and HQ are
the authorities the client observes. A group flow is not computed on a Mate's server: a group whose
Mates sleep or are gone would lose it, and a Mate's rights are not the person's.

| Fact                                                                                                                                                                                                           | Owner                                                                                                                                                                                                                                                                                                                          | Source and transport                                                                                                                                                               | Scope                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Zerops session and owner record                                                                                                                                                                                | Session machine, `cr/zerops/account/session.ts`                                                                                                                                                                                                                                                                                | REST `user/info`, `auth/*`; storage events on the session and owner keys                                                                                                           | Renderer; identity cross-tab                                                                                      |
| Organizations and memberships                                                                                                                                                                                  | Session store, refreshed by each grant round                                                                                                                                                                                                                                                                                   | REST `user/info`                                                                                                                                                                   | Epoch                                                                                                             |
| Active organization                                                                                                                                                                                            | Personal context, per tab                                                                                                                                                                                                                                                                                                      | The user                                                                                                                                                                           | Tab; no fact is keyed by it                                                                                       |
| Access grant, per project                                                                                                                                                                                      | Grant machine, `cr/zerops/data/access/grant.ts`, I/O through an `AccessVerifier` port                                                                                                                                                                                                                                          | REST rounds                                                                                                                                                                        | Epoch                                                                                                             |
| Capabilities                                                                                                                                                                                                   | `cr/zerops/data/access/capabilities.ts`, pure                                                                                                                                                                                                                                                                                  | Derived                                                                                                                                                                            | Epoch                                                                                                             |
| Org, project, service and process records; query memberships                                                                                                                                                   | `ZeropsDataRuntime`                                                                                                                                                                                                                                                                                                            | Datastream + REST anchors                                                                                                                                                          | Epoch, keyed by org, project                                                                                      |
| Project `tagList`: the `mate` marker; tags main's client wrote are carried through, never read for structure                                                                                                   | Read: the runtime's tags facet. Write: `updateProjectTags(project, patch)` only (`data/tagWriter.ts`), whose one patch is the marker (`data/tagPatch.ts`)                                                                                                                                                                      | Datastream; re-read after our own write                                                                                                                                            | Epoch                                                                                                             |
| HQ structure: applications, their projects and kinds, each Mate's record, a Mate's changes, the environments; each Mate the reader may observe — its presence and its overview — and the people the view names | HQ's stream (`cr/zerops/hq/stream.ts`, `client.ts`), held in `hqStructureAtom`; placements, environments and changes derived from it (`web/state/zerops.ts`); the Mates and people folded by `cr/zerops/hq/mates.ts`, held in `hqMatesViewAtom` and `hqPeopleViewAtom`, read for the active organization through `hqMatesAtom` | HQ `/api/structure/ws`: a snapshot with every observable Mate and the people, then whole applications, a Mate's changed sections and the people map; a snapshot again on reconnect | Epoch, per organization's HQ                                                                                      |
| HQ session                                                                                                                                                                                                     | `web/zerops/accountHq.ts`: one API per account, organization and HQ                                                                                                                                                                                                                                                            | HQ's door, presented a `mate-door:` throwaway named for HQ's project; a load presents a kept one through no door                                                                   | Kept per account, organization and HQ across loads (K7, `keptSessions.ts`); revoked at HQ when the account closes |
| An application's releases and repositories; comparisons; a repository's history; a recipe's tiers                                                                                                              | `web/zerops/useZeropsAppReleases.ts`, `useZeropsCompares.ts`, `useZeropsHistory.ts`, `useZeropsAppRecipes.ts`, over `HqApi`                                                                                                                                                                                                    | HQ REST as the person                                                                                                                                                              | Epoch                                                                                                             |
| Registry, placements, candidates, environment→project index, topology, names                                                                                                                                   | Pure selectors: the registry over HQ's structure (`cr/zerops/hq/registry.ts`), a project's place on its record (`placeProjects`), the rest over the records above                                                                                                                                                              | Derived                                                                                                                                                                            | Epoch                                                                                                             |
| Project-creation verdict                                                                                                                                                                                       | Runtime activity (the `project.create` process)                                                                                                                                                                                                                                                                                | Datastream                                                                                                                                                                         | Epoch                                                                                                             |
| Configuration, export, token, deployed-version and Mate-flag resources                                                                                                                                         | Runtime resource broker                                                                                                                                                                                                                                                                                                        | REST, on lease                                                                                                                                                                     | Lease                                                                                                             |
| Registration record                                                                                                                                                                                            | `cr/zerops/environments/records.ts`, written only by the environment machine                                                                                                                                                                                                                                                   | Written on exchange success; `localStorage`                                                                                                                                        | Account, persisted                                                                                                |
| Mate credential and install generation                                                                                                                                                                         | T3 credential store, written only by the environment machine                                                                                                                                                                                                                                                                   | Door exchange; a kept session once its Mate confirms it                                                                                                                            | Epoch; kept per account                                                                                           |
| Reachability                                                                                                                                                                                                   | `cr/zerops/environments/reachability.ts`, pure                                                                                                                                                                                                                                                                                 | Derived                                                                                                                                                                            | Epoch                                                                                                             |
| Link phase                                                                                                                                                                                                     | T3 supervisor, mirrored read-only                                                                                                                                                                                                                                                                                              | Mate WebSocket                                                                                                                                                                     | Per environment                                                                                                   |
| Descriptor facts (`environmentId`, `serverVersion`, `update`, `capabilities`, `zerops.identity`)                                                                                                               | Probe store, one per origin                                                                                                                                                                                                                                                                                                    | HTTP descriptor                                                                                                                                                                    | Epoch                                                                                                             |
| Container lifecycle and restart intents                                                                                                                                                                        | Container machine; intents persisted per tab                                                                                                                                                                                                                                                                                   | Status pushes, processes, probes, link connects, descriptor version                                                                                                                | Epoch, per target                                                                                                 |
| A Mate's press and its setup                                                                                                                                                                                   | The press (`web/zerops/matePress.ts`, steps in `cr/zerops/createEnvironment.ts`), one per project under Web Lock `mate:press:<projectId>`; its setup read off the Mate (`mateSetup.ts`)                                                                                                                                        | Platform writes, HQ's registration; `/mate/setup.json`                                                                                                                             | Tab memory; any owner or admin finishes a half-made Mate                                                          |
| Thread shell and detail                                                                                                                                                                                        | T3 `cr/state/shell.ts`, `threads.ts`                                                                                                                                                                                                                                                                                           | Mate WebSocket snapshot + sequence                                                                                                                                                 | Per environment                                                                                                   |
| Thread lifecycle envelope, agent sign-in                                                                                                                                                                       | Mate server; client feeds as `Known`                                                                                                                                                                                                                                                                                           | Mate WebSocket                                                                                                                                                                     | Per thread, per environment                                                                                       |
| Agent availability for this viewer                                                                                                                                                                             | `cr/zerops/agentAvailability.ts`, pure over `Known` inputs                                                                                                                                                                                                                                                                     | Derived                                                                                                                                                                            | Epoch                                                                                                             |
| Server session validity and revocation                                                                                                                                                                         | Mate server `ZeropsMembershipWatch`                                                                                                                                                                                                                                                                                            | Socket close, auth block                                                                                                                                                           | Per session                                                                                                       |
| Deployment per service                                                                                                                                                                                         | `cr/zerops/account/stops.ts` over `cr/data/projections/stopWork.ts`                                                                                                                                                                                                                                                            | Pushed `activeDeploy`; the organization's active versions and running work; the service's variables for the version name                                                           | Epoch, per service                                                                                                |
| Group flow, release offer, mergeability                                                                                                                                                                        | Pure projections                                                                                                                                                                                                                                                                                                               | Derived                                                                                                                                                                            | —                                                                                                                 |
| Verb attempts                                                                                                                                                                                                  | Command attempts keyed by target                                                                                                                                                                                                                                                                                               | Our verbs                                                                                                                                                                          | Epoch                                                                                                             |
| Background reconcilers (the throwaway sweep)                                                                                                                                                                   | `cr/zerops/reconcilers/*`, account workers in the post-grant stage; today a hook of the projects screen (`useZeropsThrowawaySweep`); an environment HQ holds without its attach or its deploy key is finished only when the person asks (`useFinishGroupEnvironment`, audit R2)                                                | Act only on `known` inputs with complete coverage                                                                                                                                  | Epoch                                                                                                             |
| Persisted UI state                                                                                                                                                                                             | The owning store, under `accountStorageKey`                                                                                                                                                                                                                                                                                    | Personal context                                                                                                                                                                   | Account                                                                                                           |
| Platform signals                                                                                                                                                                                               | One `PlatformSignals` port and one `DeadlineClock` port per account runtime                                                                                                                                                                                                                                                    | Visibility, focus, online, freeze/resume, wall and monotonic clocks                                                                                                                | Renderer                                                                                                          |

HQ's structure socket is a sequence of planned 100-second segments. HQ closes each with `4410`
(`segment over`), ahead of the shared IPv4's 120-second cut measured in
[`verified.md`](verified.md) ("A WebSocket through a project's shared IPv4 is cut 120 s after it
opens"). Only that code asks `cr/zerops/hq/client.ts` to mint one fresh stream ticket and open the
next segment immediately. The stream call remains pending, and the structure, changes, app reads,
Mates and people remain live until its replacement snapshot arrives. There is no client rotation
timer, retry or backoff. A failed next ticket or socket, any other close, or silence ends visibly;
the last data stands as unavailable until **Try again**. Session close `4401` also forgets the old
session for that manual attempt; leader/shutdown `1001` does not continue automatically.

Pongs are sent directly in the browser message handler before the liveness callback can remember
data in local storage; they use no timer or React scheduling. A busy main thread or a suspended
browser can still delay the message event itself. Missing pongs remain a distinct `4408` failure;
the observed missing-pong sockets have no client correlation establishing that delay's cause.

HQ has only two WebSocket routes: the structure and `/api/mate/link`. The Mate link already resolves
HQ's public address IPv6 first, retaining IPv6 connections, and replaces IPv4 or unknown-family
connections at 100 seconds (`server/zerops/ZeropsHqLink.ts`). Its successor opens beside the old
link, and the old link ends after HQ answers on the successor; that route needs no new rotation.
Desktop uses the web stream owner and the shared client. Mobile has no separate HQ structure
stream owner today; the shared client's segment contract applies to any caller it adds.

## Machines

Each machine is `transition(state, event, ctx) → {state, effects}` with
`ctx = {now: {wall, mono}, policy}`. Effects are `run`, `schedule`, `cancel`, `invalidate`,
`observe` and `log`. Timers are hints: guards are re-checked against both clocks when an event is
delivered, and wake events reach every machine. Every result carries its `(epoch, attemptId)` and is
dropped when superseded. HQ's structure stream reconnects by itself (`hqStructure.ts`): 1 s doubling
to 30 s, and every 30 s at the cap with its failure shown; a going-away (1001) gets one immediate
attempt, and a refusal waits for the manual action. Its last known data stands meanwhile. Inventory
retries on its recovery backoff and access verification on its ladders while the tab is visible, at
once on a visible wake or `online`, beside the manual action; a malformed access answer waits for the
manual action alone. Every ladder is named in `retryPolicy.ts`, and the rule they follow is the
2026-10-05 row of `design-decisions.md` (automatic recovery bounded in rate, visible, ended only by a
definitive refusal). Healthy demand can resume after a background pause. Other machines retain their own declared policies. Waiting for a capability happens before an attempt starts.

### Zerops account session

- **`booting`** — Reading the stored session
  - _Leaves on:_ None stored → `signed-out`; stored → `verifying`
- **`verifying`** — `user/info` in flight
  - _Leaves on:_ Principal verified → `signed-in` (epoch opens); a 401 whose refresh failed and
    cleared the stored session → `signed-out`; network or 5xx → `unavailable`
- **`unavailable(retryAt)`** — Zerops did not answer; a 429's Retry-After is the floor of `retryAt`
  - _Leaves on:_ Tick, online, visible, user retry, a stored session from another tab → `verifying`.
    A tick, online or visible retry is a background one: the failure stays shown, saying it tries
    again; only the person's Verify again shows a fresh check, at once even while a background
    one is still out, whose answer it supersedes. A hidden tab sends nothing on
    `online`: its visible wake checks.
- **`signed-out`** — Landing
  - _Leaves on:_ Sign-in, 2FA or hand-over here, or a session stored by another tab → `verifying`
- **`signed-in(p, epoch, gen)`** — Epoch open; token `current ⇄ refreshing` under Web Lock
  `mate:zerops-refresh`, storage re-read inside the lock
  - _Leaves on:_ Session key changed → `adopting`; key cleared, sign-out or a refresh that failed as
    expired → `signed-out`
- **`adopting(retryAt?)`** — One `user/info` with the new token; new requests wait up to 10 s
  - _Leaves on:_ Same principal and generation (or no record yet) → `signed-in`, no epoch change;
    5xx or network → retry; other principal, new generation or 401 → epoch closes, `verifying`

A tab without a generation creates the owner record once, inside the refresh lock, only if it is
still missing, so two tabs holding a session stored before the record existed converge.

### Access grant

| State                        | Meaning                                                        | Leaves on                                                                                 |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `unverified`                 | No round yet; the product is not mounted                       | Start → `verifying`                                                                       |
| `verifying(round)`           | The first round                                                | Verified → `granted`; `user/info` failed → `unverified-failed`                            |
| `unverified-failed(retryAt)` | The account gate shows the cause and Retry                     | Retry time, visible wake, online or user retry → `verifying`; malformed: user retry alone |
| `granted(evidence, renewal)` | Renewal `idle(dueAt)`, `running(round)`, `failed` or `dormant` | Account evidence expired → `lapsed`; admitted round → `granted(evidence′)`                |
| `lapsed(last, renewal)`      | Platform cells withheld, platform writes closed, UI mounted    | Admitted round → `granted`                                                                |
| `closed`                     | Epoch closed                                                   | —                                                                                         |

The round, the evidence stamp, per-project evidence, renewal lead and retries are the
[account contract](account-lifecycle.md#access-verification). In any phase: a project's 403 or 404
puts it in the closed set (writes closed at once, content withheld until a confirming read); a
project's 5xx or timeout keeps its older evidence and puts it in the unverified set with its own
retry on the project rungs; a lowered role in an admitted round applies at once. On `granted`, authority is restored to
account cells and to each project with fresh evidence; unverified projects get
`withheld(access-unverified)`, closed ones `withheld(access-denied)`. On `lapsed`, every platform
cell gets `withheld(access-lapsed)` and the broker erases its values but keeps demand.

### Capabilities

- **`platformWrite(project)`** — Account evidence not expired, the project's evidence present and
  not expired, role permits, not closed
  - _Waitable when:_ Account lapsed or unverified; project unverified
- **`platformRead(project)`** — Account evidence not expired, the project's evidence present and not
  expired, not closed
  - _Waitable when:_ — (withheld at the read)
- **`identityMint`** — A live session and the epoch's first grant; the rights-less mint is an
  account write, so a lapse does not hold it up. No organization or project role is checked: the
  door it is presented to decides, a Mate's or HQ's
  - _Waitable when:_ Before the epoch's first grant
- **`throwawayCleanup`** — Always, within the minting epoch (carrying the minting token) or under
  the same principal (the sweep)
  - _Waitable when:_ Never waits, never touches the session
- **`mate(env)`** — Post-grant stage running, credential held, link connected, and until 2.5
  `platformRead` of the Mate's project
  - _Waitable when:_ Link reconnecting

Commands await a waitable capability for up to 30 s before their attempt deadline starts, then fail
with a typed, retryable reason. A refusal is a value the caller shows, never a silent interrupt.

### Mate environment, one per target key

Four parallel regions; it lives in the post-grant stage and walks identity → grant → presence →
descriptor → exchange → thread state.

- **P, presence** — `unknown`, `present(origin)`, `transitioning(status)`, `inactive(status)`,
  `no-origin(reason)`, `gone(evidence)`
  - _Notes:_ A pure function of the listings, the records and the absences a direct read is
    confirming; holds its last value while the inventory is stale. `gone` needs evidence: the
    project missing from its organization's complete listing, or the service missing from a complete
    observing query of its project and then from a direct read of that project's services finished
    after it (C19).
- **K, credential** — `none`, `waiting(on)`, `exchanging(attempt)`, `backoff(retryAt, n, last)`,
  `refused(reason)`, `held(envId, gen)`, `retired`
  - _Notes:_ `waiting` on presence, container, access, zerops, visible or budget. A socket auth
    rejection of the installed generation → re-exchange; three in two minutes → `refused(credential)`,
    as is the door refusing the exchange's credential. A
    redeployed Mate (new `environmentId`) → `replaced`.
- **L, link** — `idle`, `connecting`, `connected(since)`, `backoff(retryAt)`, `blocked(reason)`,
  `offline`
  - _Notes:_ A read-only mirror of the T3 supervisor. Each connect is stamped.
- **C, container** — A reference to the container machine for the same key

An exchange runs when the key is wanted — while a lease holds it (step A, A9): the route names
it; it is the Mate on screen, its own view or its birth; it was left last, for 5 minutes or until
another is left; an action from outside its view holds it until the action answers
(`AccountEnvironments.hold`); the Usage page, which draws every Mate HQ names, stands
(`AccountEnvironments.setDrawn`; each project holds the project inventory a route's holds, which
admits it and lists its Mate on a cold load); or a Connect runs — and all of these hold: the post-grant stage runs,
the session is signed in, P is `present`, C is `ready` or `unknown`, no exchange is in flight for
the origin, the tab is visible or this is the route's target, the tab's exchange budget has a
token, and `identityMint` is allowed. One driver per store serves them: a target the person asked
for — the route's, the screen's, an action's, a Connect's — starts the moment it can, past every
budget; the Mates Usage draws and the Mate left last start at most 3 at once, at the door's mint
pace; single flight per
origin, 20 s per attempt. A Mate no lease holds is **parked**: the registry closes its socket and
stops its renewal, and keeps its registration, kept session and cached data; unparked, it connects
on the session it kept, through no door. A route or an action no record or descriptor names finds
its Mate through HQ's index (`hqIndex`, environment → project) with no descriptor sweep. A command
on a parked Mate is sent once its Mate connects, or after 30 s regardless (`whileMateHeld`). A transient failure is retried on the ladder (2, 4, 8, 15, 30, 60 s,
jittered; a visible wake or the network back retries at once); after five consecutive automatic
failures a target nobody looks at retries every 5 minutes, the route's stays on the ladder — until
a user retry or an input change, in this load only. A definitive refusal is never retried. Mint budgets are per tab: a burst of 10 door mints refilled
at 30 a minute, and the mint for a Mate the person asked for never waits (`doorThrowaway.ts`). A
refusal (door role refusal, a server below the floor, a project mismatch) waits for an input change;
descriptor `zerops.identity = failed` is retryable, not a refusal. Credential rotation writes
through the credential store (`registry.rotateCredential`) and never re-registers the environment.

**Reachability** is a projection over P, K, L, C and the descriptor; the first matching row wins.

| Verdict                                         | When                                                                                                          | Terminal |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `gone`                                          | P gone                                                                                                        | yes      |
| `replaced(by)`                                  | This `environmentId` was superseded                                                                           | yes      |
| `refused(role)`, `update-unavailable`           | K refused for the role, or the floor with no restart that reaches it                                          | yes      |
| `refused(configuration)`, `refused(credential)` | K refused; its reason, and Try again — never asked again on its own                                           | no       |
| `update-required(actual, min)`                  | K refused for the version and a restart reaches the floor                                                     | no       |
| `connecting(waitingOn: descriptor)`             | L blocked while K re-evaluates it                                                                             | no       |
| `ready(notice?)`                                | K held, L connected, C not inactive; a restart or update shows as a notice                                    | no       |
| `no-address(reason)`                            | P has no origin                                                                                               | no       |
| container verdict                               | C creating, provisioning, booting (the platform says so), restarting, updating, inactive or needing an action | no       |
| `not-answering(overdue)`                        | C booting only by failed probes, the link never lost here: its server is not answering; Try now               | no       |
| `waiting-for-zerops`                            | K waits on Zerops                                                                                             | no       |
| `retrying(retryAt, last)`                       | K in backoff                                                                                                  | no       |
| `reconnecting(retryAt?)`                        | K held and L lost (whatever C guesses), or K reset after an auth rejection; with L's retry time, a countdown  | no       |
| `resolving`, `connecting`                       | P unknown; otherwise                                                                                          | no       |

Every surface that links to or renders a Mate reads this projection; a link is offered when the
verdict is neither `gone` nor `replaced`.

### Mate container lifecycle, including birth

Keyed by target; it exists before any environment, which is how births are covered. A level changes
only on a read fact; a cap past its budget sets `overdue` on the current level and nothing else
(spec MC-13).

| Level                                                | Entered on                                                 | Leaves on                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `absent`                                             | —                                                          | Project `NEW`/`CREATING` → `creating`                                                                                         |
| `creating`, `creation-failed`                        | Project creation                                           | Service appears → `provisioning`; verdict failed or canceled → `creation-failed`                                              |
| `provisioning`                                       | Service `NEW`/`CREATING`/`STARTING` with a running process | `ACTIVE` → `booting`                                                                                                          |
| `booting`                                            | Container active, no answer yet (probe every 2 s)          | Descriptor or `/healthz` ready → `ready`; `/healthz` predates Mate → `needs-enable`, `needs-update` or `not-yet-available`    |
| `ready`                                              | A read proved it                                           | Platform restart → `restarting(platform)`; our intent → `restarting(you)`; update accepted → `updating`; stopped → `inactive` |
| `restarting(platform, you or announced)`, `updating` | As above                                                   | A link connect after `since`; a changed `serverVersion` (update); `/healthz` `initAt` after `since` (re-init only)            |
| `inactive(stopped)`                                  | Project or service stopped                                 | Started                                                                                                                       |
| `gone`                                               | P gone                                                     | —                                                                                                                             |

Probes run from one pool of 4 per tab, 8 s each: every 2 s while booting, restarting or updating
(then 10 s rising to 60 s once overdue), though a boot only guessed — the platform says `ACTIVE` and
nothing has answered — is read at load, on a status push, a wake or a request, and polled only while
the route or a lease waits on it; none while ready and connected; on wake, connect failure or an
exchange want while ready without a socket; none after 60 s hidden. A Mate HQ holds online is not
probed: HQ's word is the same proof a live socket is (step A, A10), and a Mate first seen before HQ
answers waits for that word, 3 s at most (`HQ_WAIT_MS`). Under an official HQ's current word, a
project it does not hold online — no Mate of HQ's there, or one it holds offline — is quiet: read
only when the route, a lease or our verb waits on it, or someone asks. The route's container and one
our verb waits on are read whatever HQ says. A Mate's birth is its press
(`web/zerops/matePress.ts`, the steps in `cr/zerops/createEnvironment.ts`): the project made or
imported, its container imported with its own key, the project closed off, the Mate registered in
HQ, then a wait for it to answer — one press per project at a time under Web Lock
`mate:press:<projectId>`. Every step is safe to ask again: a press that stopped says where and
resumes there on _Try again_, and a half-made Mate is finished from its ⋯ menu by an owner or an
admin, in any browser (_Finish setup_, the same steps). What follows runs in the container — zcp
imports the runtimes and enrolls the Mate with its HQ, the Mate server sends the stand-up — and any
browser reads where it stands off `/mate/setup.json` (`mateSetup.ts`). Nothing of a press is
stored: a reload forgets it, and HQ's structure and the listing draw the rest.

### Command attempts

| State                        | Meaning                                                 | Leaves on                                                                             |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `requested`                  | —                                                       | Capability allowed → `pending`; waitable → `awaiting-capability`; otherwise refused   |
| `awaiting-capability(until)` | Up to 30 s, before the attempt deadline starts          | Allowed → `pending`; deadline → `refused(capability reason, retryable)`               |
| `pending`                    | The attempt deadline runs                               | Accepted → `accepted`; refused → `refused`; lost after a possible write → `uncertain` |
| `accepted(receipt)`          | Invalidates the target's topics                         | —                                                                                     |
| `refused(reason)`            | Shown on that target only                               | —                                                                                     |
| `uncertain`                  | "Check the project before trying again"; never replayed | —                                                                                     |

A compound command re-checks admission before each write. Non-idempotent commands are never retried
automatically; a merge carries the head its review showed, and HQ refuses one whose head moved since
(`head_moved`).

### Route and view gate

The product mounts after the epoch's first grant and stays mounted for the epoch; nothing else
unmounts the product tree. The route gate for `/$environmentId/$threadId` is a pure projection in
`cr/zerops/environments/gate.ts`; an unknown `environmentId` resolves through a registration record,
then the descriptor index, then the descriptors of every present candidate.

| Condition                                              | Renders                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| No route environment                                   | The outlet                                                      |
| Unresolved, discovery pending                          | Wait: "Opening this conversation…"                              |
| Unresolved, every present candidate answered otherwise | Unavailable: "This conversation isn't in your Zerops projects." |
| `gone`                                                 | Unavailable: the project is no longer available                 |
| `replaced(by)`                                         | Unavailable, with Open the new one; drafts keep their keys      |
| `refused(role)`, `update-unavailable`                  | Unavailable                                                     |
| Shell has content, verdict non-terminal                | The outlet with a banner; composer disabled                     |
| No content, verdict non-terminal                       | Wait, with the verdict's phrase and action                      |
| `ready`                                                | The outlet, with a notice when one applies                      |

Once content exists for the route's environment, only a terminal verdict replaces the outlet. An
access lapse is not a gate input. A thread reads "no longer available" only when the shell is live
and lacks it, or its detail is `gone`.

Every door into a Mate — its menu row, the jump box and its toast, a project's page, an ask — opens
its conversation when that can be opened, and otherwise the Mate's own view (`/mate/$projectId`),
never the projects screen. What opens it is read off its machine
(`cr/zerops/environments/mateLink.ts`), not its listing row: a row that stands for its project
while the project's services are unread names its Mate through the project's machines, then its
record. The view shows the verdict's phrase and verbs as the gate's wait does, makes the user's
Connect by the Mate's target once a machine names it, and hands over to the conversation the moment
it can be opened, telling the door what it asked for (its Crew tab, an ask). A terminal verdict, or
a complete listing without the Mate, is said in the view with the way to the projects; nothing
navigates away on its own. A registration a machine holds is never released for a record the
storage lacks.

### Project flow per group

The flow is a projection over per-key cells, never a pass. Its parts are independent: change rows
render once HQ's stream has told a Mate's changes, and each stop renders its own
`Shown<Deployment>`. The release offer is known only when both halves are known and fresh. HQ's
environments (`hqEnvironmentsAtom`) declare which stops exist and their order; HQ's placements
declare membership. `Deployment` is `none` (the deployment facet observed with no active deploy),
`running` (activation time, version name and commit) or `deploying` (the version a build makes, and
what ran when it started); an unresolved facet is `unread`, never "Nothing deployed yet". A change
is `merged`, `closed`, or `open` with mergeability `checking`, `mergeable`, `conflicting` or
`empty`, as HQ says it (`changeMergeability.ts`); `checking` until it has said. A release, a roll back, a stage added, a merge or a close comes back down HQ's stream.
The review's header and footer read the same `changeReview` verdict: an `empty` change offers
only Close where permitted, with no merge consequence or Merge action. HQ's detail excludes the
Mate's preceding landed head from the change's commit list, so squash-landed work is not counted
again. Desktop uses this web review; mobile has no HQ change-review surface.
Door cleanup debt is recorded before the possible mint and settled per attempt only after a
refusal or a confirmed delete. Web and desktop keep it in account-scoped storage by organization,
without token values; an old account's delete writes to that captured account even after sign-out.
A reload restores the debt for the projects screen's existing sweep. Deletes run once and leave
debt on failure. The sweep waits until inventory admits the account, publishes queued/running/final
state, and persists its own failure so reloading cannot retry it. Manual cleanup refreshes the
shared token cell once and can discover legacy leftovers without debt. An organization change
ends its scope; neither its late list nor its manual ask acts on the next organization.
Mobile shares that accounting and single delete attempt in memory; it has no
projects-screen sweep today, so its host does not supply durable debt storage yet.

HQ calls are single attempts, including reads, 503 answers with `Retry-After`, and refused
sessions. A refused session is forgotten for the next explicit call. A lost write answer still
gets one confirmation read, never a repeated write. The web/desktop structure owner retains
HQ's last known rows and shows the failure when a stream ends or stops answering; another
opening waits for an explicit snapshot request. Mobile uses the same single-attempt HQ API; it has no
separate HQ structure owner today.

The stream snapshot carries each readable application's releases, repository heads and stage/production
recipes; a `release-revision` message replaces only the moved application's value. The client folds
these once (`hq/stream.ts`) and projects them without per-app bootstrap reads or recipe retry timers.
A failed revalidation preserves that app's last value with its failure; access loss removes it.

## Lifetimes

- **Renderer** — Session machine, ports
  - _Ended only by:_ Unload
- **Account epoch, pre-grant stage** — Grant, data runtime, tag writer, invalidation bus,
  personal-context handles
  - _Ended only by:_ Sign-out, principal change, unrefreshable 401
  - _May unmount:_ The product tree
- **Account epoch, post-grant stage** — T3 connection runtime (kept alive for the epoch),
  environment, container and probe stores, the deployment store, reconcilers
  - _Ended only by:_ Epoch close, never a lapse
- **Organization** — Receivers, its HQ (session, structure stream), registry
  - _Ended only by:_ Membership loss in an admitted round
  - _May unmount:_ Nothing; its rows go `gone`
- **Project** — Services, tags, deployments, group membership, access evidence
  - _Ended only by:_ `gone` with evidence
  - _May unmount:_ Nothing
- **Mate target** — Credential, T3 service scope, probe, container machine, intents
  - _Ended only by:_ P `gone`, user removal, replacement
  - _May unmount:_ Its route outlet, only by a terminal verdict
- **View** — Demand leases, ephemeral UI state
  - _Ended only by:_ Unmount

- A lifetime ends only through its owner's authoritative event; timers, data liveness and
  capabilities are never such events.
- Unmounting releases demand only. A store may evict an unleased entry after 10 minutes idle (the
  resource broker's cells, `data/cells.ts`); a later reader starts a new identity at `unread`.
- Losing a capability — a lapsed grant or project, a denied role, an HQ that does not answer, a
  blocked Mate link — never tears down state or UI.
- Cancellation is structural: every effect runs in a fiber owned by its entry's scope and carries an
  AbortSignal. Commands past their first possible write are never aborted; throwaway deletes run in
  uninterruptible finalizers carrying the minting token.
- Every result and machine event is checked against the epoch before it is admitted.
- Account-level demand (organization and project inventory, remembered targets) is held by the
  account runtime, not by mounted components.
- A failure in one scope stays there: one org's receiver, one blocked interest, one project's failed
  access read or one malformed frame degrades only that scope's regions.
- Account close runs one hook, in order: lock, flush drafts, revoke Mate sessions, forget the HQ
  sessions, dispose the post-grant stores, shut down the data runtime, dispose the atom registry.
  Leftover throwaways are swept at the same principal's next epoch.

## Data flow and invalidation

Observations flow only into owners; surfaces read only projections and send back only intents
(demand, commands, "Try again").

| Push                                      | Facts touched                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Datastream frame                          | Platform records; derived joins recompute reactively, no bus involved                                                                                    |
| HQ structure stream                       | Registry, placements, group members, environments, a Mate's changes and its record; each observed Mate's presence and overview, and the people they name |
| Project tags change                       | Whether a project is a Mate (the `mate` marker)                                                                                                          |
| Service `activeDeploy` change             | Deployment: a new version-name key                                                                                                                       |
| Service status, terminal process          | Container lifecycle, birth, `Deployment.deploying`                                                                                                       |
| Mate shell and thread streams             | Thread shell and detail                                                                                                                                  |
| Mate `subscribeVcsStatus`                 | The Git tab's checkout, one subscription per mount                                                                                                       |
| Agent-auth feed                           | Agent sign-in, agent availability                                                                                                                        |
| Socket auth block, close and close reason | Credential region, `waiting(on: zerops)`, link block mapping                                                                                             |
| Link connect                              | Ends container `restarting` and `updating`                                                                                                               |
| Accepted verb                             | Its target's topics                                                                                                                                      |
| Storage events                            | Session and owner record; registration records                                                                                                           |
| BroadcastChannel `mate:account`           | The carried invalidation topics                                                                                                                          |

**The invalidation bus** is a `PubSub` owned by the account runtime: a closed, typed set of
revalidation requests with no data and no merge semantics. Topics: `access` (granted, lapsed,
renew-now), `inventory(org)`, `project`, `environment(target, why)`, `container(target)`,
`deployment(service)`. Only owners
of pull-based facts subscribe; the runtime accepts only `inventory` and `access`. Invalidations
coalesce per key over 250 ms; in a hidden tab they collect into a dirty set flushed, visible first,
on the next visible wake.

A Mate link drop or a door's project mismatch asks the data runtime for that project's presence:
its project record and a direct list of its services. Outstanding checks share one read pair per
project. They use the existing inventory identity and leave the organization's receiver and held
registrations alone. Actual receiver failures publish a failed state and reconnect on their own
backoff; a manual attempt does so at once.

HQ supplies application load data with its first structure snapshot, and fresh values when each
application's release revision moves. Recomputes reuse unchanged revisions. _Add Mate_ and the
stage/production creation forms use those same recipe values, every tier from the snapshot; a recipe
landing moves the revision and its tiers come down the stream. An explicit recipe retry asks the
stream owner for a fresh snapshot.

**Polling is a backstop, and this is the complete list.**

| Fact                                              | Backstop                                                                                       | Runs only while                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| Access grant                                      | Healthy renewal before its deadline; a failed check on its ladder                              | Epoch open, hidden under 60 minutes |
| Inventory, activity                               | None: resnapshot on reconnect, foreground and explicit refresh                                 | —                                   |
| Tags                                              | Re-read after our own writes and on a cross-tab invalidation                                   | —                                   |
| An application's releases and repositories        | None: values in HQ's snapshot and release-revision messages (`useZeropsAppReleases`)           | An official HQ is known             |
| HQ's structure, environments and a Mate's changes | None: HQ's stream, reconnecting by itself 1 s → 30 s; a refusal waits for a manual again       | —                                   |
| HQ's standing (the projects page's HQ card)       | None: stream's verdict, Core and parts; `/health` once per failed attempt                      | The tab is visible                  |
| A recipe's tiers on `main`                        | None: Mate, stage and production tiers in the same snapshot and messages                       | —                                   |
| A comparison of two commits                       | None: asked once and held; one that failed is asked again a minute later (`useZeropsCompares`) | Still wanted                        |
| Deployment name                                   | 30 s while a deploy of that service runs and the pushed name is unconfirmed                    | Demanded                            |
| A Mate's setup (`/mate/setup.json`)               | 4 s while a step is still to happen (`useMateSetup`); a read due while hidden waits            | A view shows it, the tab is visible |
| Container probe                                   | The container machine's cadence                                                                | Its state requires it               |
| Throwaway sweep                                   | Once for durable debt past the door window; failed sweeps require explicit again               | The projects screen is open         |

**Wake.** A visible wake is one coalesced event, at most one per 10 s, on: visible again after at
least 30 s hidden, `pageshow` with `persisted`, `resume`, `online`, sleep detected while visible,
and focus after at least 30 s hidden or blurred. Sleep is the wall clock outrunning the monotonic
clock by more than 5 s between ticks, or a tick gap over 5 minutes; hidden-tab throttling alone
never looks like sleep. A hidden wake only re-evaluates deadlines (the grant); retries and probes
wait for the next visible wake. Offline pauses rounds, retries and probes.

**Ordering.** Each store processes events one at a time; I/O runs concurrently and results come back
fenced by attempt id and read-start ordinal. Effects apply after the state is published. Single
flight per key: one exchange per origin, one probe per origin, one read per fact and key, one grant
round. `tagList` is written by one tag writer that reads, applies a pure patch, writes and reads
back, serialized per project and under Web Lock `mate:tags:<projectId>` across tabs; the platform
has no conditional write, so a cross-device race remains within one read-write round trip. A key's
project list is written under Web Lock `mate:token:<tokenId>`, from a list read inside the lock.

**Multi-tab.** No tab leads. Each has its own runtime, grant and mint budgets; the Mates' and HQ's
sessions are kept per account in the storage every tab reads (`keptSessions.ts`), and one its Mate
or HQ no longer takes is forgotten. The cross-tab channels are closed:

| Channel                                | Carries                                            | Guard                                                               |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Storage event, session key             | Sign-in, refresh, sign-out, to tabs in every state | Verified adoption                                                   |
| Storage event, owner key               | Login generation                                   | Consumed only by tabs without a generation                          |
| Web Lock `mate:zerops-refresh`         | Token refresh; owner-record creation               | Storage re-read inside the lock                                     |
| Web Lock `mate:tags:<projectId>`       | Tag patches                                        | Fresh read inside the lock                                          |
| Web Lock `mate:press:<projectId>`      | One press or _Finish setup_ per project            | —                                                                   |
| Web Lock `mate:token:<tokenId>`        | One key's read-then-write                          | Fresh read inside the lock                                          |
| BroadcastChannel `mate:account`        | Invalidations after account-level writes           | Dropped unless `{userId, loginGeneration}` matches the open account |
| Storage events on registration records | Store reload                                       | Account-scoped keys; never credentials                              |

## Module boundaries

`cr/zerops/` is UI-free and platform-free (design-system R1).

```
knowledge/     known.ts (Known, Shown, Cell, read, advance), presentation.ts (knownPresentation),
               invalidation.ts (union + bus), signals.ts (PlatformSignals), clock.ts (DeadlineClock)
store/         kit.ts — makeStore({initial, transition, interpret, atoms}): serialized queue,
               effect interpreter, per-key publication through `read`
account/       session.ts (machine + owner record), accountRuntime.ts (composition root per epoch:
               pre-grant and post-grant stages), ports.ts
data/          the data runtime, plus access/grant.ts, access/verifier.ts, access/capabilities.ts;
               commands: updateProjectTags(project, patch)
environments/  records.ts, probeStore.ts, containerMachine.ts, environmentMachine.ts,
               exchangeDriver.ts, reachability.ts, gate.ts, descriptorIndex.ts
hq/            client.ts (HQ's API, through its door), stream.ts, registry.ts, placement.ts,
               birth.ts, anchor.ts
flow/          deployment.ts, groupFlow.ts
               (projectFlow.ts, release.ts, groupDeploys.ts)
reconcilers/   the throwaway sweep
projections/   candidates.ts, sidebar rows, banner, Git tab, birth progress, agentAvailability.ts
testing/       accountHarness.ts, explore.ts
api.ts                 + deleteThrowaway({clientId, tokenId, name}, {token})
serverCompatibility.ts   the one version comparison, including whether a restart reaches the floor
```

Dependency rules, each an import-graph test in `scripts/mate-zone-architecture.test.ts` once the
[status table](#status-by-phase) says so:

1. `cr/zerops/**` imports no React and no DOM globals.
2. Machine and reducer files import no Effect runtime, fetch or storage, and read no clock: no
   `Date.now`, `performance.now`, argument-less `new Date()` or timer; time comes in through
   `ctx.now`. Drivers reach sources only through ports.
3. `projections/**`, `flow/groupFlow.ts` and `environments/{reachability,gate}.ts` are pure,
   reading no clock by the same measure.
4. Web and mobile components import hooks only — never a store, `api.ts` or `fetch` — and set no
   timer for data.
5. `Cell` and `advance` stay private to their store; `.value` is read only in selectors.
6. Dependencies run one way: data runtime ← environments ← flow.
   Nothing depends on `account/` except the web and mobile bindings and, inside `cr/zerops`,
   `account/` itself and the `testing/` harness, which drives sessions; post-grant modules are
   constructed only by `accountRuntime.ts`.
7. Protected roots render only (design-system R2).

The web binding is one `AccountBoundary` that builds one account runtime per epoch from web ports
(fetch, WebSocket, account storage, `sessionStorage` for intents, signals, the clock, Web Locks,
BroadcastChannel, the `MessageChannel` scheduler) and renders the product gate. Mobile builds the
same runtime from React Native ports: `AppState`, NetInfo, its storage adapter, an in-process mutex
for locks, a no-op broadcast and the Effect scheduler.

## Status by phase

Slices are numbered by phase: 0 stabilizes, 1 puts `Known` at every boundary, 2 moves the grant into
the runtime, 3 builds environments, containers and births, 4 the forge and flow, 5 views and
withholding; S is the Mate server, and a server item holds on Mates at or above the release that
carries it. "Live" means it holds on `rebuild/int` today; "gone" names the slice that removed a part
whose fact is now another owner's or no longer exists.

| Item                                                                                                                                               | Status                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Platform data runtime: records, interests, receivers, resource broker, commands                                                                    | Live                                                                                                                            |
| T3 shell and thread stores                                                                                                                         | Live                                                                                                                            |
| Account epoch and its fence at the web boundary                                                                                                    | Live                                                                                                                            |
| Active organization per tab                                                                                                                        | Live                                                                                                                            |
| Agent availability as one projection                                                                                                               | Live                                                                                                                            |
| Server membership watch: 300 s re-check, two-pass rule, 24-hour maximum age                                                                        | Live; the interval clamped to at most 300 s (S.0) from the first release after 0.11.41                                          |
| Mate sessions kept per account, presented again once their Mate confirms them                                                                      | Live                                                                                                                            |
| Gitea sessions forgotten on account close                                                                                                          | Gone with T12: the client holds no Gitea session                                                                                |
| Account harness and sign-in guards                                                                                                                 | Live                                                                                                                            |
| `Known`, `Shown`, `Cell`, `knownPresentation`, retry policy                                                                                        | Live                                                                                                                            |
| Grant reducer with per-project evidence and policy constants                                                                                       | Live                                                                                                                            |
| REST-only renewal, round-start evidence, per-project admission, writes open during renewal                                                         | Live                                                                                                                            |
| `deleteThrowaway` with the minting token; per-tab mint budgets                                                                                     | Live                                                                                                                            |
| `registry.rotateCredential`                                                                                                                        | Live                                                                                                                            |
| Environment machine and reachability                                                                                                               | Live                                                                                                                            |
| One exchange driver for restore, auto-connect and repair                                                                                           | Auto-connect gone with A9 (`2a78cb1ede`): the driver serves restore, repair and the leases, and a Mate no lease holds is parked |
| Content-based route gate over the driver's machines, and one link predicate                                                                        | Live                                                                                                                            |
| A lapse never unmounts (opaque overlay, portals removed, title neutralized)                                                                        | Live; replaced by per-region withholding in 5.1                                                                                 |
| Session machine: cross-tab sign-in without reload, owner record, verified adoption                                                                 | Live                                                                                                                            |
| `Deployment` from the pushed facet; per-group publication                                                                                          | Live; `deploying` in 4.4                                                                                                        |
| Gitea session machine                                                                                                                              | Gone with T12 (`23762ac9b3`)                                                                                                    |
| Mergeability shared by the flow, Git tab, banner and change page                                                                                   | Live, as HQ says it (`changeMergeability.ts`)                                                                                   |
| Broker leases as cells, withheld and re-admitted per scope                                                                                         | Live                                                                                                                            |
| Invalidation bus and cross-tab channel                                                                                                             | Live                                                                                                                            |
| Inventory selectors return `Known`; presence `unknown`                                                                                             | Live                                                                                                                            |
| The candidate listing's web consumers read `Known` through selectors                                                                               | Live                                                                                                                            |
| Mate feeds as `Known`                                                                                                                              | Live                                                                                                                            |
| Lint `t3code/no-failure-to-empty` and the `Cell` zone rule                                                                                         | Live                                                                                                                            |
| Runtime hygiene: failures retry on their own backoff beside manual again, late success cannot reopen failed/paused demand, scoped malformed frames | Live                                                                                                                            |
| Grant machine inside the data runtime; pre-grant and post-grant stages                                                                             | Live                                                                                                                            |
| Capabilities; typed refusals from commands                                                                                                         | Live                                                                                                                            |
| Refresh epoch deleted; callers become intents                                                                                                      | Live                                                                                                                            |
| Rights-less throwaway mint no longer waits for the account window                                                                                  | Live                                                                                                                            |
| Mate commands need the Mate session only                                                                                                           | 2.5, after S.0 is released                                                                                                      |
| First mount on the first grant alone                                                                                                               | Live                                                                                                                            |
| Registration records, followed across tabs                                                                                                         | Live; the legacy keys are no longer read                                                                                        |
| Probe store, container machine, persisted intents                                                                                                  | Live; a Mate HQ holds online is not probed since A10 (`85be2642a1`)                                                             |
| A Mate leaves the catalog only after a direct project-services read confirms its absence (C19)                                                     | Live                                                                                                                            |
| Cached descriptor index, no sweep; `replaced`                                                                                                      | Live                                                                                                                            |
| Environment store in the post-grant stage                                                                                                          | Live                                                                                                                            |
| Birth store and worker                                                                                                                             | Gone: a Mate's birth is the press (`web/zerops/matePress.ts`), its setup read off the Mate                                      |
| Derived topology, names and Mate atoms                                                                                                             | Live                                                                                                                            |
| Mobile on the shared candidate selectors and container store                                                                                       | Live                                                                                                                            |
| Mobile reachability, hosted by a mobile account runtime                                                                                            | Live                                                                                                                            |
| Wake definition; a stream defect leaves `live`; thread gate                                                                                        | Live                                                                                                                            |
| Forge store with its scheduler                                                                                                                     | Gone with T9b and T12: changes, merges, releases, history and comparisons are HQ's                                              |
| Registry as a projection of HQ's structure                                                                                                         | Live (`hq/registry.ts`, T5); a projection of tags before                                                                        |
| HQ's structure stream, its placements, environments and changes as atoms                                                                           | Live (T5, T7c)                                                                                                                  |
| A Mate's key lowered to its own project, no grant on its application's others                                                                      | Live (T12, `04d73b1557`)                                                                                                        |
| One tag writer                                                                                                                                     | Live                                                                                                                            |
| `groupFlow`, per-verb attempts, envelope and VCS invalidations                                                                                     | 4.5; old hooks deleted in 4.6                                                                                                   |
| Reconcilers as account workers                                                                                                                     | 4.7                                                                                                                             |
| Server lifecycle feed keeps each thread's latest value; one bad event never stops the ingest                                                       | Live from the first release after 0.11.41                                                                                       |
| Signer re-read before refusing a turn                                                                                                              | Live from the first release after 0.11.41                                                                                       |
| A turn failing authentication re-probes the agent's sign-in                                                                                        | Live from the first release after 0.11.41                                                                                       |
| Agent login reports its exit                                                                                                                       | Live from the first release after 0.11.41                                                                                       |
| A deploy operation becomes uncertain after its cap                                                                                                 | Live                                                                                                                            |
| Descriptor boot identity, server state stream, identity verdict split, close reasons                                                               | S.6                                                                                                                             |
| Persisted UI keys under the account key; a sign-in lands on its deep link or /zerops                                                               | Live                                                                                                                            |
| Zone tests: one owner per fact family, no component I/O, no data timers                                                                            | 5.5                                                                                                                             |
| Dependency rule 1 (`cr/zerops/**` imports no React and no DOM globals)                                                                             | Live                                                                                                                            |
| Dependency rule 2 (machine and reducer files import no Effect runtime, fetch or storage)                                                           | Live; zone test "rule 2"                                                                                                        |
| Dependency rule 3 (projections and the named pure modules are pure)                                                                                | Live; zone test "rule 3"                                                                                                        |
| Dependency rules 2 and 3 read no clock and set no timer                                                                                            | Live; zone tests "rule 2" and "rule 3"                                                                                          |
| Dependency rule 4 (components import hooks only and set no data timer)                                                                             | 5.5                                                                                                                             |
| Dependency rule 5 (`Cell` and `advance` private to their store; `.value` only in selectors)                                                        | Live                                                                                                                            |
| Dependency rule 6, one way (only `account/` and `testing/` depend on `account/`)                                                                   | Live; zone test "rule 6"                                                                                                        |
| Dependency rule 6, construction (post-grant modules built only by `accountRuntime.ts`)                                                             | Live; zone test "rule 6"                                                                                                        |
| Dependency rule 7 (protected roots render only)                                                                                                    | Live                                                                                                                            |

A release made before production exists is recorded by HQ as a snapshot. Its approved record is the terminal result: the client shows Saved and starts no deployment clock. An organization owner or admin may make it; once production exists, the release requires its deploy rights. HQ captures production’s id for the attempt and refuses if that placement changes before tagging.
