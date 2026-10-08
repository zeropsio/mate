# Client data layer

Remote facts have one path: **source adapter → reducer → account store → projection → surface**.
The shared implementation belongs in `packages/client-runtime/src/data`; web and mobile use it,
and desktop uses the web client. Provider evidence enters through the [provider runtime SPI](spi.md).

## Ownership

Each fact has one authoritative source and one writer in the client. Facts are keyed by domain
identity, within the verified account's lifetime. Remote values and verdicts stay in account memory;
browser storage holds local preferences, drafts and sign-in state under their own contracts.
A family may declare a display label safe to retain after deletion or denial. The project family
retains only its name for recovery messages; its protected payload is still purged. Returning
membership requests an owner read before restoring a purged project. A remembered value grants no access. Each write is authorized by its owner when it runs.

Keep value, authority, source order, coverage, freshness and access separate. A working transport
does not prove that a scope is current or authorized. Missing, partial, stale and refused evidence
are different states. Absence and deletion need affirmative owner evidence; silence, omitted data,
transport failure and elapsed time prove neither.

## Observation

Adapters normalize source evidence; the reducer alone admits and orders it. Commit a baseline
atomically, then admit newer input buffered while it was read. Fence obsolete attempts and closed
account lifetimes. Scope a damaged or refused read to the evidence it affects. Keep known values
through transient failures; withhold protected values when access is unverified and purge them on
an authoritative denial.
Whole-value replacement requires complete evidence for that identity; partial input preserves
unproven values. Replaceable observations keep distinct identities by owner and purpose. Releasing a view releases its demand; ending the owning account closes
its observations before disposing their state.

Share account-wide observations. Hold detail only while a consumer or an accepted operation
needs it; share demand and release it at the last holder. Forgetting returns released detail to
unknown; it never claims deletion. Use the source's realtime
contract where available. A sampled source declares its demand and freshness policy centrally;
components never add independent fetch, polling or recovery loops.

Projections are pure functions over keyed facts, source coverage, access and operations. Surfaces
read projections, express demand and submit intents. They do not own a second remote cache, infer
person facts from credentials or substitute clock order for source order. Retry policy belongs to
the shared stream supervisor. Automatic recovery is visible and bounded in rate while demanded.
Every wait has a deadline or names its next action. A definitive refusal stops automatic recovery
and waits for changed input, changed access or an explicit retry.

Agent admission consumes the selected login's authentication facts and typed command refusal
identity. It does not infer permission from signer records; the server still admits every command.
Refusals join by login ID. A cold auth read holds the input without presenting stale configuration;
a failed or unsupported read retains explicit configuration evidence. The composer owns the primary
explanation, the menu links to it, and the conversation header adds no second sign-in chip.

## Writes and evidence

Record an operation and its identity before sending. Acceptance, reflection in observed facts and
completion are separate states. An accepted operation retains its observation demand after the
originating surface closes. Operation predicates stay pure; adapters and executors own remote I/O.

Resolve a lost answer by its original request identity, handle or uniquely attributable owner
evidence. Never blindly repeat a write that may have been accepted. A disappearing process or an
observation deadline cannot manufacture success or failure. When the outcome cannot be recovered,
retain an unresolved receipt naming who acts next and what they can do.

New families, projections and operations use these same boundaries. Replacing an input preserves
every existing product test sentence and follows all affected clients. Keep source-specific wire
shapes, policies and surface behavior in code and tests; platform assumptions belong beside the
code that depends on them or in a short ledger with a verification command.

- Projects grouping reads `inventoryGroups`; compact flow and row summaries read keyed application, placement, access and service facts through `projectFlow` and `projectSummary`. Mate activity is keyed by project. Collapsed rows hold no app detail; expansion and review share detail demand, while stop version/deploy cells retain their platform summary demand. The shared flow join preserves the existing operation and remainder model. Desktop uses this web path; mobile remains on its current path.

### Hosted client guard completion and mobile later

The hosted client reads Git reachability, workspace search/diffs, clone state, provider configuration,
client access, and shell/thread replay through account-owned families. Snapshot/replay engines retain
only transport synchronization buffers; account facts hold the reusable conversation snapshots and
thread resume cursor. Creation presses keep local selection and retry callbacks, while progress and
outcomes come from operation receipts. An uncertain write withholds automatic retry. Stand-up retry
acceptance holds setup demand until a newer owner report settles it.

Mobile remains on its current path. The remaining guard exceptions below also cover shared helpers
whose retained readers are used only by mobile; they are not a hosted-client migration escape hatch.
Counts enumerate every remaining ledger entry, including repeated uses in a file.

| Guard             | Path                                                             | Entries | Reason (mobile later)                                                               |
| ----------------- | ---------------------------------------------------------------- | ------: | ----------------------------------------------------------------------------------- |
| Remote I/O        | `apps/mobile/src/features/cloud/linkEnvironment.ts`              |       1 | native account connection uses its current HTTP transport                           |
| Remote I/O        | `apps/mobile/src/features/zerops/mate-descriptors.ts`            |       1 | native pre-session identity discovery still uses its existing descriptor transport  |
| Remote I/O        | `apps/mobile/src/lib/runtime.ts`                                 |       2 | native HTTP and socket hosts retain their current transports                        |
| Retired mechanism | `apps/mobile/src/features/archive/useArchivedThreadSnapshots.ts` |       2 | native archive snapshots retain their existing query reader                         |
| Retired mechanism | `apps/mobile/src/features/usage/UsageRouteScreen.tsx`            |       1 | native usage presentation remains on its existing provider usage reader             |
| Retired mechanism | `apps/mobile/src/features/zerops/account-ports.ts`               |       1 | native HQ absence bridge has not migrated to account inventory coverage             |
| Retired mechanism | `apps/mobile/src/features/zerops/environment-ports.ts`           |       1 | native HQ absence bridge has not migrated to account inventory coverage             |
| Retired mechanism | `apps/mobile/src/features/zerops/useZeropsCandidates.ts`         |       1 | native candidate selection has not migrated to account projections                  |
| Retired mechanism | `apps/mobile/src/state/assets.ts`                                |       2 | native asset reads retain their existing query reader                               |
| Retired mechanism | `apps/mobile/src/state/attachments.ts`                           |       2 | native attachment reads retain their existing query reader                          |
| Retired mechanism | `apps/mobile/src/state/filesystem.ts`                            |       2 | native filesystem reads retain their existing query reader                          |
| Retired mechanism | `apps/mobile/src/state/queries.ts`                               |       2 | native thread-search aggregation retains its existing query reader                  |
| Retired mechanism | `apps/mobile/src/state/review.ts`                                |       2 | native review reads retain their existing query reader                              |
| Retired mechanism | `apps/mobile/src/state/server.ts`                                |       2 | native configuration, provider settings and telemetry keep the existing native path |
| Retired mechanism | `apps/mobile/src/state/sourceControl.ts`                         |       2 | native source-control discovery and clone feeds keep the existing native path       |
| Retired mechanism | `apps/mobile/src/state/terminal.ts`                              |       2 | native terminal metadata and session subscriptions keep the existing native path    |
| Retired mechanism | `apps/mobile/src/state/usage.ts`                                 |       1 | native usage reader remains on its existing provider usage path                     |
| Retired mechanism | `apps/mobile/src/state/vcs.ts`                                   |       2 | native VCS refs and summary subscriptions keep the existing native path             |
| Retired mechanism | `packages/client-runtime/src/state/archivedThreads.ts`           |       1 | native archive snapshots retain their existing query reader                         |
| Retired mechanism | `packages/client-runtime/src/state/assets.ts`                    |       1 | native asset reads retain their existing query reader                               |
| Retired mechanism | `packages/client-runtime/src/state/attachments.ts`               |       1 | native attachment reads retain their existing query reader                          |
| Retired mechanism | `packages/client-runtime/src/state/filesystem.ts`                |       1 | native filesystem reads retain their existing query reader                          |
| Retired mechanism | `packages/client-runtime/src/state/review.ts`                    |       1 | native review reads retain their existing query reader                              |
| Retired mechanism | `packages/client-runtime/src/state/runtime.ts`                   |       4 | generic query/subscription factories serve only the deferred native readers         |
| Retired mechanism | `packages/client-runtime/src/state/server.ts`                    |       1 | native configuration, provider settings and telemetry keep the existing native path |
| Retired mechanism | `packages/client-runtime/src/state/session.ts`                   |       3 | native bootstrap and client-access atoms retain their existing session path         |
| Retired mechanism | `packages/client-runtime/src/state/shell.ts`                     |       2 | native shell compatibility facade preserves snapshot/replay and persistence         |
| Retired mechanism | `packages/client-runtime/src/state/sourceControl.ts`             |       1 | native source-control discovery and clone feeds keep the existing native path       |
| Retired mechanism | `packages/client-runtime/src/state/terminal.ts`                  |       4 | native terminal metadata and session subscriptions keep the existing native path    |
| Retired mechanism | `packages/client-runtime/src/state/threadSearch.ts`              |       1 | native thread-search reader retains its existing query factory                      |
| Retired mechanism | `packages/client-runtime/src/state/threads.ts`                   |       4 | native thread compatibility facade and resume family preserve replay and pagination |
| Retired mechanism | `packages/client-runtime/src/state/vcs.ts`                       |       3 | native VCS refs and summary subscriptions keep the existing native path             |
| Retired mechanism | `packages/client-runtime/src/zerops/projections/candidates.ts`   |       1 | native candidate selection has not migrated to account projections                  |

Mate resource health has its own revision and subscription, independent of conversation reads,
and travels to HQ in an independent `health` frame, retained in `hq_mate_health`. Both paths enter the `mateHealth`
family. The server's resource-health owner decides status, ordered resources and severity. The client
projection presents that verdict, including retained reports, and joins source freshness separately.
A configured RAM minimum cannot prove an allocation update failed. `memory.max` is currently
granted RAM; `memory.high` is a routinely crossed reclaim threshold. I/O stalls are distinct from
state-disk exhaustion. Raw reclaim, swap and PSI evidence remains available in the health drawer.
New counters are optional on the wire for retained reports and older Mates. Kernel cgroup v2 evidence and state-disk free space determine resource strain; a transport failure never does. An unavailable
source retains the permitted report labelled last-known. Memory and disk reads run at startup and on
kernel notifications, PSI triggers and state-directory changes. CPU and memory/swap counter comparisons have a
centrally owned two-second observation cadence, including quiet windows for recovery. This is the
kernel's shortest unprivileged PSI tracking window, not a truth threshold. Current runnable demand
is compared with the visible cgroup's cpuset and quota allocation; historical PSI averages alone
cannot establish exhaustion. Requests and unrelated notifications do not replace that observation window.

- Hosted images retain their object URL and a detached decoded browser resource by representation
  digest within the account lifetime. Remounts read an authorized retained preview before measuring
  the new slot; mutable paths still revalidate metadata, then reuse bytes only for the confirmed
  digest. Access withdrawal releases browser resources; account closure revokes every URL. Desktop
  inherits this web path. Mobile later: native image presentation and byte retention stay unchanged.
