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

| Axis       | Question               | Owner                                                                               | Changes on                                                                | May never                                            |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mounting   | Is this UI alive?      | The account epoch (from its first grant), and a route for its own outlet            | Sign-in, sign-out, principal change, navigation, a terminal route verdict | Depend on data liveness or on the access window      |
| Capability | May I do X now?        | The grant (per project), the Zerops session, the Gitea session, the Mate credential | Renewal, denial, session loss                                             | Unmount UI, or erase facts that are not secrets      |
| Freshness  | Is what I see current? | Each fact                                                                           | Pushes, reads, pauses, failures                                           | Turn _known_ back into _unknown_ within one identity |

## Seven laws

1. **One fact, one owner.** Each remote fact has one writer: an account-scoped store in
   `cr/zerops`. Components never copy, time or catch a remote fact.
2. **One knowledge type.** Every remote fact reaches a projection as `Known<T>`. No remote fact is
   `T | undefined`.
3. **Negatives are earned.** "Nothing deployed yet", "No open pull requests" and "no longer
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

| Term                | Meaning                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account epoch       | One verified Zerops principal in one renderer (`currentAccountEpoch()`). Opens when the session verifies a principal; closes on sign-out, principal change or an unrefreshable 401. A result from a closed epoch is dropped by the store that receives it.                       |
| Pre-grant stage     | Built when the principal is verified: session, grant, data runtime.                                                                                                                                                                                                              |
| Post-grant stage    | Built on the epoch's first `granted`: T3 connection runtime, environment, container, birth and probe stores, Gitea sessions, forge and deployment stores, reconcilers. Nothing in it runs before the platform has confirmed organizations, projects and roles.                   |
| Owner record        | `zerops-mate.zerops-session-owner.v1 = {userId, loginGeneration}` beside the unchanged session key. Written only by a tab that verified the principal; a refresh never changes it. It is the cross-tab epoch.                                                                    |
| Target key          | A Mate's identity: `projectId:serviceId`. `environmentId` is an attribute learned from the descriptor; names, URLs and origins are addresses, never identities.                                                                                                                  |
| Source              | A system that answers with authority, reached through one adapter: Zerops REST, the Zerops datastream, a Mate's descriptor and `/healthz`, a Mate's WebSocket RPC, Gitea REST as the person, the Gitea broker. Storage, visibility, locks and clocks are signals, never sources. |
| Observation         | One arrival of evidence (a frame, a response, a descriptor, a close code, a storage event), stamped with a local ordinal and receipt time, admitted or rejected by its owner. Never rendered directly.                                                                           |
| Fact                | A typed statement one owner holds about one entity, keyed by its natural identity. A key never contains a generation counter, a set of unrelated ids, or the active organization.                                                                                                |
| Store (owner)       | The one module allowed to change a family of facts: a serialized event queue feeding a pure `transition(state, event, now) → {state, effects}`, publishing one atom per key.                                                                                                     |
| Machine             | The statechart of one entity inside a store: a discriminated union with a total transition function. No boolean, ref, attempted-set or epoch counter stands in for a state.                                                                                                      |
| Command, attempt    | An intent to change a source. A command never writes a fact: its response is an observation plus invalidations, and it is never replayed after a write may have been accepted.                                                                                                   |
| Capability          | A derived answer to "may this class of command run now": `allowed`, or `no` with a typed reason and a `waitable` flag.                                                                                                                                                           |
| Grant               | The client's verified authority: account evidence (user, organizations, round stamp) and per-project evidence (effective role and mutation flags, each with its own stamp). Authority for a project ends 15 minutes after its own stamp.                                         |
| Demand (lease)      | A view's declaration that it shows a key. Drives priority and may start a subscription or a backstop. Releasing it never blanks a mounted neighbour.                                                                                                                             |
| Invalidation        | A typed message that facts under a key may have changed at the source. Carries no data.                                                                                                                                                                                          |
| Intent              | A local, time-boxed expectation from our own command ("we asked this Mate to restart at T"). It changes how observations are interpreted, survives a reload of its tab, and past its budget becomes `overdue`, never another state.                                              |
| Projection, verdict | A pure function from knowledge, capabilities and `now` to a view model; a verdict is a render-ready projection. Neither holds state.                                                                                                                                             |
| Personal context    | Account-scoped, non-secret records in browser storage: registrations, births, intents, drafts, UI preferences. Never authority for existence or access; always revalidated against facts.                                                                                        |

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
| Prerequisite     | `zerops-session`, `access-grant`, `gitea-session`, `mate-session`, `presence`, `visible`, `online`                                               |
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

A fact is owned where it is born and where its authority is checked. The Mate server owns what is
born in its container (boot, planned stops, the sessions it issued, its key's verdict, its checkout,
its agent's tool results, agent sign-in). zcp reaches the client only through the Mate server. The
client owns the person's facts (identity, grant, Gitea as the person), facts spanning several Mates
(inventory, registry, group flows) and facts about this browser's path (reachability, probes, this
tab's credentials). Zerops and Gitea stay the authorities the client observes. A group flow is not
computed on the server: a group whose Mates sleep or are gone would lose it, and a bot's rights are
not the person's.

| Fact                                                                                                   | Owner                                                                                 | Source and transport                                                     | Scope                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| Zerops session and owner record                                                                        | Session machine, `cr/zerops/account/session.ts`                                       | REST `user/info`, `auth/*`; storage events on the session and owner keys | Renderer; identity cross-tab |
| Organizations and memberships                                                                          | Session store, refreshed by each grant round                                          | REST `user/info`                                                         | Epoch                        |
| Active organization                                                                                    | Personal context, per tab                                                             | The user                                                                 | Tab; no fact is keyed by it  |
| Access grant, per project                                                                              | Grant machine, `cr/zerops/data/access/grant.ts`, I/O through an `AccessVerifier` port | REST rounds                                                              | Epoch                        |
| Capabilities                                                                                           | `cr/zerops/data/access/capabilities.ts`, pure                                         | Derived                                                                  | Epoch                        |
| Org, project, service and process records; query memberships                                           | `ZeropsDataRuntime`                                                                   | Datastream + REST anchors                                                | Epoch, keyed by org, project |
| Project `tagList` (group, role, signer, bot, release switch, registry)                                 | Read: the runtime's tags facet. Write: `updateProjectTags(project, patch)` only       | Datastream; re-read after our own write                                  | Epoch                        |
| Registry, candidates, environment→project index, topology, names                                       | Pure selectors over the records above                                                 | Derived                                                                  | Epoch                        |
| Project-creation verdict                                                                               | Runtime activity (the `project.create` process)                                       | Datastream                                                               | Epoch                        |
| Configuration, export, token, deployed-version and Mate-flag resources                                 | Runtime resource broker                                                               | REST, on lease                                                           | Lease                        |
| Registration record                                                                                    | `cr/zerops/environments/records.ts`, written only by the environment machine          | Written on exchange success; `localStorage`                              | Account, persisted           |
| Mate credential and install generation                                                                 | T3 credential store, written only by the environment machine                          | Door exchange                                                            | Epoch, memory only           |
| Reachability                                                                                           | `cr/zerops/environments/reachability.ts`, pure                                        | Derived                                                                  | Epoch                        |
| Link phase                                                                                             | T3 supervisor, mirrored read-only                                                     | Mate WebSocket                                                           | Per environment              |
| Descriptor facts (`environmentId`, `serverVersion`, `update`, `capabilities`, `zerops.identity`)       | Probe store, one per origin                                                           | HTTP descriptor                                                          | Epoch                        |
| Container lifecycle and restart intents                                                                | Container machine; intents persisted per tab                                          | Status pushes, processes, probes, link connects, descriptor version      | Epoch, per target            |
| Birth record                                                                                           | `cr/zerops/birth/birthStore.ts` and one account worker                                | Container facts, activity, tags                                          | Account, persisted           |
| Thread shell and detail                                                                                | T3 `cr/state/shell.ts`, `threads.ts`                                                  | Mate WebSocket snapshot + sequence                                       | Per environment              |
| Thread lifecycle envelope, agent sign-in                                                               | Mate server; client feeds as `Known`                                                  | Mate WebSocket                                                           | Per thread, per environment  |
| Agent availability for this viewer                                                                     | `cr/zerops/agentAvailability.ts`, pure over `Known` inputs                            | Derived                                                                  | Epoch                        |
| Server session validity and revocation                                                                 | Mate server `ZeropsMembershipWatch`                                                   | Socket close, auth block                                                 | Per session                  |
| Gitea discovery per org                                                                                | Selector over the records                                                             | Derived                                                                  | Epoch                        |
| Gitea person session                                                                                   | `cr/zerops/forge/giteaSession.ts`, one per (epoch, Gitea origin)                      | Broker `POST /person/token` via a throwaway                              | Epoch                        |
| Repositories, pull requests, tags, releases, `environments.yaml`, branch heads, commit statuses        | `cr/zerops/forge/forgeStore.ts`                                                       | Gitea REST as the person                                                 | Epoch; bounded LRU unleased  |
| Deployment per service                                                                                 | `cr/zerops/flow/deploymentStore.ts`                                                   | Pushed `activeDeploy`; REST for the version name; Gitea for build status | Epoch, per service           |
| Group flow, release offer, MergeState                                                                  | Pure projections                                                                      | Derived                                                                  | —                            |
| Verb attempts                                                                                          | Command attempts keyed by target                                                      | Our verbs                                                                | Epoch                        |
| Background reconcilers (group reach, deploy-token gaps, throwaway sweep, half-made group environments) | `cr/zerops/reconcilers/*`, account workers in the post-grant stage                    | Act only on `known` inputs with complete coverage                        | Epoch                        |
| Persisted UI state                                                                                     | The owning store, under `accountStorageKey`                                           | Personal context                                                         | Account                      |
| Platform signals                                                                                       | One `PlatformSignals` port and one `DeadlineClock` port per account runtime           | Visibility, focus, online, freeze/resume, wall and monotonic clocks      | Renderer                     |

## Machines

Each machine is `transition(state, event, ctx) → {state, effects}` with
`ctx = {now: {wall, mono}, policy}`. Effects are `run`, `schedule`, `cancel`, `invalidate`,
`observe` and `log`. Timers are hints: guards are re-checked against both clocks when an event is
delivered, and wake events reach every machine. Every result carries its `(epoch, attemptId)` and is
dropped when superseded. Backoff is 2, 4, 8, 15, 30, 60 s with ±20 % jitter; a visible wake,
`online`, a user retry or a relevant input change resets it. Waiting for a capability happens before
an attempt starts and never consumes its deadline.

### Zerops account session

| State                      | Meaning                                                                                                        | Leaves on                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booting`                  | Reading the stored session                                                                                     | None stored → `signed-out`; stored → `verifying`                                                                                                                            |
| `verifying`                | `user/info` in flight                                                                                          | Principal verified → `signed-in` (epoch opens); a 401 whose refresh failed and cleared the stored session → `signed-out`; network or 5xx → `unavailable`                    |
| `unavailable(retryAt)`     | Zerops did not answer                                                                                          | Tick, online, visible, user retry, a stored session from another tab → `verifying`                                                                                          |
| `signed-out`               | Landing                                                                                                        | Sign-in, 2FA or hand-over here, or a session stored by another tab → `verifying`                                                                                            |
| `signed-in(p, epoch, gen)` | Epoch open; token `current ⇄ refreshing` under Web Lock `mate:zerops-refresh`, storage re-read inside the lock | Session key changed → `adopting`; key cleared, sign-out or a refresh that failed as expired → `signed-out`                                                                  |
| `adopting(retryAt?)`       | One `user/info` with the new token; new requests wait up to 10 s                                               | Same principal and generation (or no record yet) → `signed-in`, no epoch change; 5xx or network → retry; other principal, new generation or 401 → epoch closes, `verifying` |

A tab without a generation creates the owner record once, inside the refresh lock, only if it is
still missing, so two tabs holding a session stored before the record existed converge.

### Access grant

| State                        | Meaning                                                                  | Leaves on                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `unverified`                 | No round yet; the product is not mounted                                 | Start → `verifying`                                                           |
| `verifying(round)`           | The first round                                                          | Verified → `granted`; `user/info` or an org list failed → `unverified-failed` |
| `unverified-failed(retryAt)` | The account gate shows the cause and Retry                               | Tick, online, visible, user retry → `verifying`                               |
| `granted(evidence, renewal)` | Renewal `idle(dueAt)`, `running(round)`, `backoff(retryAt)` or `dormant` | Account evidence expired → `lapsed`; admitted round → `granted(evidence′)`    |
| `lapsed(last, renewal)`      | Platform cells withheld, platform writes closed, UI mounted              | Admitted round → `granted`                                                    |
| `closed`                     | Epoch closed                                                             | —                                                                             |

The round, the evidence stamp, per-project evidence, renewal lead and retries are the
[account contract](account-lifecycle.md#access-verification). In any phase: a project's 403 or 404
puts it in the closed set (writes closed at once, content withheld until a confirming read); a
project's 5xx or timeout keeps its older evidence and puts it in the unverified set with its own
retry; a lowered role in an admitted round applies at once. On `granted`, authority is restored to
account cells and to each project with fresh evidence; unverified projects get
`withheld(access-unverified)`, closed ones `withheld(access-denied)`. On `lapsed`, every platform
cell gets `withheld(access-lapsed)` and the broker erases its values but keeps demand.

### Capabilities

| Capability               | Allowed when                                                                                                                                                                                | Waitable when                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `platformWrite(project)` | Account evidence not expired, the project's evidence present and not expired, role permits, not closed                                                                                      | Account lapsed or unverified; project unverified |
| `platformRead(project)`  | Account evidence not expired, the project's evidence present and not expired, not closed                                                                                                    | — (withheld at the read)                         |
| `identityMint`           | The account window is open; from 2.4 the rights-less mint needs only a live session and the epoch's first grant. No organization or project role is checked: the door and the broker decide | Account lapsed (until 2.4)                       |
| `throwawayCleanup`       | Always, within the minting epoch (carrying the minting token) or under the same principal (the sweep)                                                                                       | Never waits, never touches the session           |
| `mate(env)`              | Post-grant stage running, credential held, link connected, and until 2.5 `platformRead` of the Mate's project                                                                               | Link reconnecting                                |
| `forge(origin)`          | Gitea session signed in                                                                                                                                                                     | Acquiring, pending                               |

Commands await a waitable capability for up to 30 s before their attempt deadline starts, then fail
with a typed, retryable reason. A refusal is a value the caller shows, never a silent interrupt.

### Mate environment, one per target key

Four parallel regions; it lives in the post-grant stage and walks identity → grant → presence →
descriptor → exchange → thread state.

| Region        | States                                                                                                                      | Notes                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P, presence   | `unknown`, `present(origin)`, `transitioning(status)`, `inactive(status)`, `no-origin(reason)`, `gone(evidence)`            | A pure function of the candidate; holds its last value while the inventory is stale. `gone` needs evidence: the project gone after a confirming read, or the service absent from a complete observing query and a direct read. |
| K, credential | `none`, `waiting(on)`, `exchanging(attempt)`, `backoff(retryAt, n, last)`, `refused(reason)`, `held(envId, gen)`, `retired` | `waiting` on presence, container, access, zerops, visible or budget. A socket auth rejection of the installed generation → re-exchange; three in two minutes → backoff. A redeployed Mate (new `environmentId`) → `replaced`.  |
| L, link       | `idle`, `connecting`, `connected(since)`, `backoff(retryAt)`, `blocked(reason)`, `offline`                                  | A read-only mirror of the T3 supervisor. Each connect is stamped.                                                                                                                                                              |
| C, container  | A reference to the container machine for the same key                                                                       | —                                                                                                                                                                                                                              |

An exchange runs when the key is wanted (the route targets it, a registration record exists, the
user pressed Connect, a live intent of ours, auto-connect for ready Mates in the active org, or a
birth past hardening) and all of these hold: the post-grant stage runs, the session is signed in,
P is `present`, C is `ready` or `unknown`, no exchange is in flight for the origin, the tab is
visible or this is the route's target, the tab's exchange budget has a token, and `identityMint` is
allowed. One driver per store serves them route target first, then visible rows, remembered Mates,
auto-connect; concurrency 3, single flight per origin, 20 s per attempt. After five consecutive
automatic failures a target retries every 5 minutes until a user retry or an input change. Mint
budgets are per tab: 10 exchanges a minute, and a separate 4 a minute for Gitea. A refusal (door
role refusal, a server below the floor, a project mismatch) waits for an input change; descriptor
`zerops.identity = failed` is retryable, not a refusal. Credential rotation writes through the
credential store (`registry.rotateCredential`) and never re-registers the environment.

**Reachability** is a projection over P, K, L, C and the descriptor; the first matching row wins.

| Verdict                               | When                                                                                   | Terminal |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `gone`                                | P gone                                                                                 | yes      |
| `replaced(by)`                        | This `environmentId` was superseded                                                    | yes      |
| `refused(role)`, `update-unavailable` | K refused for the role, or the floor with no restart that reaches it                   | yes      |
| `update-required(actual, min)`        | K refused for the version and a restart reaches the floor                              | no       |
| `connecting(waitingOn: descriptor)`   | L blocked while K re-evaluates it                                                      | no       |
| `ready(notice?)`                      | K held, L connected, C not inactive; a restart or update shows as a notice             | no       |
| `no-address(reason)`                  | P has no origin                                                                        | no       |
| container verdict                     | C creating, provisioning, booting, restarting, updating, inactive or needing an action | no       |
| `waiting-for-zerops`                  | K waits on Zerops                                                                      | no       |
| `retrying(retryAt, last)`             | K in backoff                                                                           | no       |
| `reconnecting`                        | K held and L not connected, or K reset after an auth rejection                         | no       |
| `resolving`, `connecting`             | P unknown; otherwise                                                                   | no       |

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
(then 10 s rising to 60 s once overdue); none while ready and connected; on wake, connect failure or
an exchange want while ready without a socket; none after 60 s hidden. A birth record
`{target, startedAt, step: tags | registry | harden | health, overdue}` starts at create-accepted and
is driven by one account worker under Web Lock `mate:birth:<projectId>`; auto-connect waits for
`harden` to be done.

### Gitea session, one per (epoch, Gitea origin)

| State                                 | Meaning                                             | Leaves on                                                                                                                    |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `idle`                                | Not demanded                                        | Demand, signed in, post-grant, discovery known → `waiting` then `acquiring`                                                  |
| `waiting(on: identityMint or budget)` | —                                                   | Guard met → `acquiring`                                                                                                      |
| `acquiring(attempt)`                  | A `gitea-signin` throwaway and `POST /person/token` | OK → `signed-in`; broker 502/503 → `pending`; unreachable → `unavailable`; 403 → `refused`; Zerops 401 → the session machine |
| `signed-in(token, expiresAt)`         | Requests carry the token                            | Demanded near expiry → `renewing`; not demanded at expiry → `idle`; a Gitea 401 → `reacquiring`                              |
| `renewing`                            | The old token stays in use                          | OK → `signed-in`; failure → `signed-in` until expiry, then `unavailable`                                                     |
| `reacquiring`                         | Requests queue up to 10 s, then retry once          | OK → `signed-in`; a third 401 in 10 minutes → `refused`                                                                      |
| `pending(setting-up, retryAt)`        | Gitea is still setting up (5 s rising to 60 s)      | Retry after a credential-less liveness request to the broker origin; no answer → next rung, no mint                          |
| `unavailable(cause, retryAt, n)`      | Broker unreachable (10 s rising to 60 s)            | Same as `pending`                                                                                                            |
| `refused(reason, retryAt)`            | Gitea or the broker said no                         | Every 5 minutes while visible, or a user retry or role change → `acquiring`                                                  |
| `closed`                              | Epoch closed; token forgotten                       | —                                                                                                                            |

Dependent facts wait in `unread(waitingFor: gitea-session)` or stay `known(stale)` for the first
two failed acquisitions, then show the cause. A 401 never blanks them.

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
automatically; a pull request is looked up by head branch before one is opened.

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

### Project flow per group

The flow is a projection over per-key cells, never a pass. Its halves are independent: pull request
rows render once the open pulls are known, and each stop renders its own `Shown<Deployment>`. The
release offer is known only when both halves are known and fresh. `environments.yaml` declares which
stops exist and their order; project tags declare membership. `Deployment` is `none` (the deployment
facet observed with no active deploy), `running` (activation time, version name and commit, build
status) or `deploying`; an unresolved facet is `unread`, never "Nothing deployed yet".
`MergeState` is `merged`, `closed`, or `open` with mergeability `checking`, `mergeable` or
`conflicting` and a checks summary; Gitea's `mergeable: false` reads `checking` until a confirming
read, and Merge is offered only on `mergeable` with the cell fresh. A verb invalidates exactly what
it changed: merge the pull request, the repository's pulls and `main`; release and roll back the
group repository's tags; open a pull request the repository's pulls; add a stage the declarations.

## Lifetimes

| Scope                           | Owns                                                                                                                                                       | Ended only by                                 | May unmount                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| Renderer                        | Session machine, ports                                                                                                                                     | Unload                                        | —                                            |
| Account epoch, pre-grant stage  | Grant, data runtime, tag writer, invalidation bus, personal-context handles                                                                                | Sign-out, principal change, unrefreshable 401 | The product tree                             |
| Account epoch, post-grant stage | T3 connection runtime (kept alive for the epoch), environment, container, birth and probe stores, Gitea sessions, forge and deployment stores, reconcilers | Epoch close, never a lapse                    | —                                            |
| Organization                    | Receivers, Gitea discovery, registry                                                                                                                       | Membership loss in an admitted round          | Nothing; its rows go `gone`                  |
| Project                         | Services, tags, deployments, group membership, access evidence                                                                                             | `gone` with evidence                          | Nothing                                      |
| Mate target                     | Credential, T3 service scope, probe, container machine, intents                                                                                            | P `gone`, user removal, replacement           | Its route outlet, only by a terminal verdict |
| View                            | Demand leases, ephemeral UI state                                                                                                                          | Unmount                                       | —                                            |

- A lifetime ends only through its owner's authoritative event; timers, data liveness and
  capabilities are never such events.
- Unmounting releases demand only. A store may evict an unleased entry after 10 minutes idle (an LRU
  of 500 pull request entities); a later reader starts a new identity at `unread`.
- Losing a capability — a lapsed grant or project, a denied role, a refused Gitea session, a blocked
  Mate link — never tears down state or UI.
- Cancellation is structural: every effect runs in a fiber owned by its entry's scope and carries an
  AbortSignal. Commands past their first possible write are never aborted; throwaway deletes run in
  uninterruptible finalizers carrying the minting token.
- Every result and machine event is checked against the epoch before it is admitted.
- Account-level demand (organization and project inventory, remembered targets) is held by the
  account runtime, not by mounted components.
- A failure in one scope stays there: one org's receiver, one blocked interest, one project's failed
  access read or one malformed frame degrades only that scope's regions.
- Account close runs one hook, in order: lock, flush drafts, revoke Mate sessions, forget Gitea
  tokens, dispose the post-grant stores, shut down the data runtime, dispose the atom registry.
  Leftover throwaways are swept at the same principal's next epoch.

## Data flow and invalidation

Observations flow only into owners; surfaces read only projections and send back only intents
(demand, commands, "Try again").

| Push                                      | Facts touched                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Datastream frame                          | Platform records; derived joins recompute reactively, no bus involved          |
| Project tags change                       | Registry, group members, signer overlay                                        |
| Service `activeDeploy` change             | Deployment: a new version-name key                                             |
| Service status, terminal process          | Container lifecycle, birth, `Deployment.deploying`                             |
| Mate shell and thread streams             | Thread shell and detail                                                        |
| Mate `subscribeVcsStatus`                 | Invalidates the checkout's forge repository                                    |
| zcp lifecycle envelope                    | Git push or pull request tool → forge repository; deploy finished → deployment |
| Agent-auth feed                           | Agent sign-in, agent availability                                              |
| Socket auth block, close and close reason | Credential region, `waiting(on: zerops)`, link block mapping                   |
| Link connect                              | Ends container `restarting` and `updating`                                     |
| Accepted verb                             | Its target's topics                                                            |
| Storage events                            | Session and owner record; registration and birth records                       |
| BroadcastChannel `mate:account`           | The carried invalidation topics                                                |

**The invalidation bus** is a `PubSub` owned by the account runtime: a closed, typed set of
revalidation requests with no data and no merge semantics. Topics: `access` (granted, lapsed,
renew-now), `inventory(org)`, `project`, `environment(target, why)`, `container(target)`,
`deployment(service)`, `gitea-session(origin)`, `forge-org`, `forge-repo`, `forge-pr`. Only owners
of pull-based facts subscribe; the runtime accepts only `inventory` and `access`. Invalidations
coalesce per key over 250 ms; in a hidden tab they collect into a dirty set flushed, visible first,
on the next visible wake.

**Polling is a backstop, and this is the complete list.**

| Fact                                   | Backstop                                                                    | Runs only while                     |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Access grant                           | Renewal before its deadline; per-project retry for unverified projects      | Epoch open, hidden under 60 minutes |
| Inventory, activity                    | None: resnapshot on reconnect, foreground and explicit refresh              | —                                   |
| Registry, tags                         | Re-read after our own writes and on a cross-tab invalidation                | —                                   |
| Pull request lists, repositories, tags | 60 s; on visible wake when older than 30 s                                  | Demanded and visible                |
| A pull request in `checking`           | 2, 5, 10 s                                                                  | Demanded and checking               |
| Commit status                          | 15 s, up to 20 minutes                                                      | Demanded, visible, pending          |
| `environments.yaml`, tiers on `main`   | 5 minutes                                                                   | Demanded and visible                |
| Deployment name                        | 30 s while a deploy of that service runs and the pushed name is unconfirmed | Demanded                            |
| Container probe                        | The container machine's cadence                                             | Its state requires it               |
| Gitea token                            | Before `expiresAt`                                                          | Demanded                            |
| Throwaway sweep                        | Epoch open, then every 5 minutes                                            | Visible                             |

**Wake.** A visible wake is one coalesced event, at most one per 10 s, on: visible again after at
least 30 s hidden, `pageshow` with `persisted`, `resume`, `online`, sleep detected while visible,
and focus after at least 30 s hidden or blurred. Sleep is the wall clock outrunning the monotonic
clock by more than 5 s between ticks, or a tick gap over 5 minutes; hidden-tab throttling alone
never looks like sleep. A hidden wake only re-evaluates deadlines (the grant, Gitea expiry); retries,
probes and forge flushes wait for the next visible wake. Offline pauses rounds, retries, probes and
forge reads.

**Ordering.** Each store processes events one at a time; I/O runs concurrently and results come back
fenced by attempt id and read-start ordinal. Effects apply after the state is published. Single
flight per key: one exchange per origin, one acquisition per Gitea origin, one probe per origin, one
read per fact and key, one grant round. `tagList` is written by one tag writer that reads, applies a
pure patch, writes and reads back, serialized per project and under Web Lock `mate:tags:<projectId>`
across tabs; the platform has no conditional write, so a cross-device race remains within one
read-write round trip. `environments.yaml` writes carry the blob sha and re-apply once on conflict.

**Multi-tab.** No tab leads. Each has its own runtime, grant, Mate sessions, Gitea token and mint
budgets. The cross-tab channels are closed:

| Channel                                          | Carries                                            | Guard                                                               |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------- |
| Storage event, session key                       | Sign-in, refresh, sign-out, to tabs in every state | Verified adoption                                                   |
| Storage event, owner key                         | Login generation                                   | Consumed only by tabs without a generation                          |
| Web Lock `mate:zerops-refresh`                   | Token refresh; owner-record creation               | Storage re-read inside the lock                                     |
| Web Lock `mate:tags:<projectId>`                 | Tag patches                                        | Fresh read inside the lock                                          |
| Web Lock `mate:birth:<projectId>`                | One birth driver                                   | —                                                                   |
| BroadcastChannel `mate:account`                  | Invalidations after account-level writes           | Dropped unless `{userId, loginGeneration}` matches the open account |
| Storage events on registration and birth records | Store reload                                       | Account-scoped keys; never credentials                              |

## Module boundaries

`cr/zerops/` is UI-free and platform-free (design-system R1).

```
knowledge/     known.ts (Known, Shown, Cell, read, advance), presentation.ts (knownPresentation),
               invalidation.ts (union + bus), signals.ts (PlatformSignals), clock.ts (DeadlineClock),
               retryPolicy.ts
store/         kit.ts — makeStore({initial, transition, interpret, atoms}): serialized queue,
               effect interpreter, per-key publication through `read`
account/       session.ts (machine + owner record), accountRuntime.ts (composition root per epoch:
               pre-grant and post-grant stages), ports.ts
data/          the data runtime, plus access/grant.ts, access/verifier.ts, access/capabilities.ts;
               commands: updateProjectTags(project, patch)
environments/  records.ts, probeStore.ts, containerMachine.ts, environmentMachine.ts,
               exchangeDriver.ts, reachability.ts, gate.ts, descriptorIndex.ts
birth/         birthStore.ts
forge/         giteaSession.ts, forgeStore.ts, mergeState.ts
flow/          deploymentStore.ts, groupFlow.ts, envelopeInvalidations.ts
               (projectFlow.ts, release.ts, groupDeploys.ts)
reconcilers/   groupReach.ts, deployTokenGaps.ts, throwawaySweep.ts
projections/   candidates.ts, sidebar rows, banner, Git tab, birth progress, agentAvailability.ts
testing/       accountHarness.ts, explore.ts
api.ts                 + deleteThrowaway({clientId, tokenId, name}, {token})
serverCompatibility.ts   the one version comparison, including whether a restart reaches the floor
```

Dependency rules, each an import-graph test in `scripts/mate-zone-architecture.test.ts` once the
[status table](#status-by-phase) says so:

1. `cr/zerops/**` imports no React and no DOM globals.
2. Machine and reducer files import no Effect runtime, fetch or storage; drivers reach sources only
   through ports.
3. `projections/**`, `flow/groupFlow.ts` and `environments/{reachability,gate}.ts` are pure.
4. Web and mobile components import hooks only — never a store, `api.ts`, `giteaClient.ts` or
   `fetch` — and set no timer for data.
5. `Cell` and `advance` stay private to their store; `.value` is read only in selectors.
6. Dependencies run one way: data runtime ← environments ← flow, and data runtime ← forge ← flow.
   Nothing depends on `account/` except the web and mobile bindings; post-grant modules are
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
carries it. "Live" means it holds on `main` today.

| Item                                                                                                        | Status                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Platform data runtime: records, interests, receivers, resource broker, commands                             | Live                                             |
| T3 shell and thread stores                                                                                  | Live                                             |
| Account epoch and its fence at the web boundary                                                             | Live                                             |
| Active organization per tab                                                                                 | Live                                             |
| Agent availability as one projection                                                                        | Live; takes `Known` inputs from 1.4              |
| Server membership watch: 300 s re-check, two-pass rule, 24-hour maximum age                                 | Live; interval clamped to at most 300 s from S.0 |
| Mate credentials in memory only                                                                             | Live                                             |
| Gitea sessions forgotten on account close                                                                   | 0.1                                              |
| Account harness and sign-in guards                                                                          | 0.0                                              |
| `Known`, `Shown`, `Cell`, `knownPresentation`, retry policy                                                 | 0.4                                              |
| Grant reducer with per-project evidence and policy constants                                                | 0.5                                              |
| REST-only renewal, round-start evidence, per-project admission, writes open during renewal                  | 0.6                                              |
| Throwaway mint waits for the account window; `deleteThrowaway` with the minting token; per-tab mint budgets | 0.7                                              |
| `registry.rotateCredential`                                                                                 | 0.8                                              |
| Environment machine and reachability, with an interim container region                                      | 0.9a; container region replaced in 3.2           |
| One exchange driver for restore, auto-connect and repair                                                    | 0.9b; its React shell deleted in 3.4             |
| Content-based route gate and one link predicate                                                             | 0.9c; descriptor sweep from 3.3                  |
| A lapse never unmounts (opaque overlay, portals closed, title neutralized)                                  | 0.10; replaced by per-region withholding in 5.1  |
| Session machine: cross-tab sign-in without reload, owner record, verified adoption                          | 0.11                                             |
| `Deployment` from the pushed facet; per-group publication                                                   | 0.12; complete with `deploying` in 4.4           |
| Gitea session machine                                                                                       | 0.13                                             |
| `MergeState` shared by the flow, Git tab, banner and change page                                            | 0.14                                             |
| Broker leases as cells, withheld and re-admitted per scope                                                  | 1.1                                              |
| Invalidation bus and cross-tab channel                                                                      | 1.2                                              |
| Inventory selectors return `Known`; presence `unknown`                                                      | 1.3                                              |
| Mate feeds as `Known`                                                                                       | 1.4                                              |
| Lint `t3code/no-failure-to-empty` and the `Cell` zone rule                                                  | 1.5                                              |
| Runtime hygiene: no stranded `recovering`, resume reuses a live receiver, scoped malformed frames           | 1.6                                              |
| Grant machine inside the data runtime; pre-grant and post-grant stages                                      | 2.1                                              |
| Capabilities; typed refusals from commands                                                                  | 2.2                                              |
| Refresh epoch deleted; callers become intents                                                               | 2.3                                              |
| Rights-less throwaway mint no longer waits for the account window                                           | 2.4                                              |
| Mate commands need the Mate session only                                                                    | 2.5, after S.0 is released                       |
| First mount on the first grant alone                                                                        | 2.6                                              |
| Registration records                                                                                        | 3.1; legacy keys deleted in 5.4                  |
| Probe store, container machine, persisted intents                                                           | 3.2                                              |
| Descriptor index and full sweep; `replaced`                                                                 | 3.3                                              |
| Environment store in the post-grant stage                                                                   | 3.4                                              |
| Birth store and worker                                                                                      | 3.5                                              |
| Derived topology, names and Mate atoms                                                                      | 3.6                                              |
| Mobile on the shared selectors and reachability                                                             | 3.7                                              |
| Wake definition; a stream defect leaves `live`; thread gate                                                 | 3.8                                              |
| Forge store with its scheduler                                                                              | 4.1                                              |
| Registry as a projection of tags                                                                            | 4.2                                              |
| One tag writer                                                                                              | 4.3                                              |
| `groupFlow`, per-verb attempts, envelope and VCS invalidations                                              | 4.5; old hooks deleted in 4.6                    |
| Reconcilers as account workers                                                                              | 4.7                                              |
| Server lifecycle feed keeps each thread's latest value                                                      | S.1                                              |
| Signer re-read before refusing a turn                                                                       | S.2                                              |
| A turn failing authentication re-probes the agent's sign-in                                                 | S.3                                              |
| Agent login reports its exit; a deploy operation becomes uncertain after its cap                            | S.4, S.5                                         |
| Descriptor boot identity, server state stream, identity verdict split, close reasons                        | S.6                                              |
| Persisted UI keys under the account key; the last route through the gate                                    | 5.2                                              |
| Zone tests: one owner per fact family, no component I/O, no data timers                                     | 5.5                                              |
| Dependency rule 1 (`cr/zerops/**` imports no React and no DOM globals)                                      | Live                                             |
| Dependency rule 2 (machine and reducer files import no Effect runtime, fetch or storage)                    | 0.Z; zone test "rule 2"                          |
| Dependency rule 3 (projections and the named pure modules are pure)                                         | Stated; no slice adds its test yet               |
| Dependency rule 4 (components import hooks only and set no data timer)                                      | 5.5                                              |
| Dependency rule 5 (`Cell` and `advance` private to their store; `.value` only in selectors)                 | 1.5                                              |
| Dependency rule 6 (one-way dependencies; post-grant modules built only by `accountRuntime.ts`)              | Stated; no slice adds its test yet               |
| Dependency rule 7 (protected roots render only)                                                             | Live                                             |
