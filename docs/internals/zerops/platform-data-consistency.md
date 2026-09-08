# Zerops data consistency contract

Status: implemented consistency contract, 2026-09-08. Companion to the
[architecture decision](platform-data-architecture.md). This specifies local
behavior under incomplete upstream guarantees; it does not invent guarantees for
Zerops. Production adapters and runtime reducers enforce the admission rules below.

## Source authority

| Source                                          | Permitted effect                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indexed search, including subscription response | Establish that query's membership/window; seed unknown entity fields. Never overwrite fields already owned by admitted direct reads or pushes. Search lag is measured in [the ledger](verified.md).                          |
| Direct entity/project collection read           | Update explicitly owned field groups under the read ticket rules below. A traversal is not an atomic snapshot.                                                                                                               |
| Native entity update                            | Apply the decoded present fields in local receipt order. Omitted fields stay unchanged unless that exact source contract defines replacement. Explicit null and array replacement are domain decisions, covered by fixtures. |
| Native membership delta                         | Change the named query's membership only. It cannot delete an entity, revoke access or declare a process finished.                                                                                                           |
| Embedded related entity                         | Supply references and explicitly owned embedded facts. Never implicitly overwrite the related entity's canonical record.                                                                                                     |
| Command response                                | Record acceptance/uncertainty and explicit source references; decode any returned domain observation through the same admission policy. HTTP success alone is not resource convergence.                                      |
| Mate lifecycle/tool result                      | Remains a distinct source. Platform activity is an overlay and never the tool-result verdict.                                                                                                                                |

Start with a few explicit field groups, not a general field-version framework.
Inventory summaries, configuration facets and metrics have separate owners.
For ServiceStack, Process and Project, specify the exact field allowlist alongside
the adapter decoder. Do not store entire search DTOs: project search responses can
contain environment values, and process rows contain user/profile data.

Preserve useful `_version`, `lastUpdate`, process `sequence`, `parentId` and
`rootId` metadata where supplied. Their names/presence do not establish a revision
clock, global sequence or causal graph. Enable revision rejection only after
verifying scope, reset behavior and cross-source comparability. Explicit process
relationships may be used once decoded and their meaning verified; time proximity
remains tentative attribution.

## Public state and ownership

One runtime per `(normalized API origin, authenticated account, account epoch)`.
Use an organization receiver initially; no token string appears in identities.
Credential refresh preserves the account model only within the same verified
principal. Logout/account replacement disposes its entire scope even if the
mutable API client instance is reused.

| Record          | Required meaning                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity/facet    | `unresolved`, `observed`, or scoped `unavailable`; accepted source and local observation stamp.                                                            |
| Query           | Descriptor, ordered IDs, unresolved IDs, observed total, traversal/window coverage. Query key includes scope/filter/sort/projection/window/schema version. |
| Interest        | `establishing`, `observing`, `recovering`, `paused`, `failed`, plus reason and generation.                                                                 |
| Read            | Pending/succeeded/failed and completion marker independent of whether values changed.                                                                      |
| Access          | Existing account/project verification scope, deadline and revocation policy; arrival of ordinary data does not extend it.                                  |
| Command attempt | Pending/accepted/rejected/uncertain, target scope and zero or more explicit process references.                                                            |

`observing` has guarantee `source-order-unverified`: required registrations and
baseline reads completed and there is no known delivery failure. It does not mean
source-current, gap-free or atomic. Required interests determine view readiness;
optional metrics/log failures affect their own region. Ordinary read failure is
distinct from direct evidence of unavailability.

`servicesOf(project)` derives canonical inventory relationships, including directly
observed services and native discoveries. It must not simply alias an indexed
search's current membership. A running-process view derives actual Process status;
cover `PENDING`, `RUNNING`, `ROLLBACKING`, `CANCELING` and all terminal states
`FINISHED`, `FAILED`, `CANCELED`. Unknown status never means idle or success.
Terminal records remain available to retained history/operation views.

## Fixed bootstrap and recovery algorithm

1. Create account, receiver and interest generations. Install frame routing before
   any registration request. Use a bounded serialized admission queue; network
   requests may run concurrently under one account-wide scheduler.
2. Register entity update interests before list registrations and baseline reads.
   Accept admissible pushes during establishment. Register each fully described
   query under an opaque wire identity mapped locally to its descriptor.
3. At every read dispatch create a ticket with generations, request ID, local
   receipt ordinal and monotonically increasing read-start ordinal. This is local
   bookkeeping, never a platform cursor. Capture a membership start marker for
   collection reads.
4. Route search responses through the search policy above. Establish direct anchors
   for required inventory/activity once per establishment or recovery: the organization
   project collection, each demanded project's detail and services, and running
   processes only for topology/activity demand. These reads replace stale indexed
   seed values under the ordinary read/push fences. A restricted membership
   (Developer/Guest) cannot read the organization project collection directly; on
   `forbidden` the anchor falls back to the permission-filtered project search,
   admitted as indexed search, so the interest still completes and per-project
   anchors keep their authority. An unopened project's inventory
   never downloads process history. Hydrate unresolved
   added IDs with one shared in-flight request per target/facet and bounded retries.
5. On a direct result reject obsolete generations. For each owned field group,
   suppress values if a native observation arrived after the ticket began, or a
   later-started direct read has already applied. Apply unaffected groups. **Mark
   the read succeeded even if every value was suppressed.** A push racing a read
   does not itself schedule another read or prevent establishment from finishing.
   Read success is independent of required-field completeness: a partial push can
   leave a suppressed group's required fields unresolved. Selectors retain that
   state rather than invent defaults; shared hydration can resolve missing facts.
6. For each query descriptor/generation, suppress a baseline older than its last
   applied read-start ordinal, while still completing that read successfully.
   Apply an admitted baseline to its declared scope/window, then the latest intervening
   membership operation per ID, including removal markers. This is a local conflict
   policy; it does not prove source ordering. Release markers when no older active
   read needs them. Overflow discards the uncertain baseline and enters recovery.
7. Finish establishment/recovery when required registrations and baseline read
   completions have crossed the ingestion queue's completion markers. Do not wait
   for a quiet source, empty queue or uncontested field replacement.
8. On disconnect, registration failure, malformed required data or overflow mark
   affected interests recovering before any lossy discard. Fence old generations;
   use a new receiver on reconnect and uncertain registration ownership. Rebuild
   active registrations and direct anchors through the same algorithm.
9. Bound establishment/token/open/greeting/read deadlines and recovery attempts.
   Repeated failures reach an explicit failed state with controlled retry, never
   an endless initial spinner. Foreground return also checks expired access and
   recovers paused interests before reporting observing.

Example: GET starts → push observes FINISHED → GET returns RUNNING. Retain FINISHED,
record the GET's successful completion and finish recovery when other prerequisites
succeed. A new GET started after that push may update the group if no newer push
intervenes. A delayed unversioned push arriving after the GET may still regress
source state; the client cannot distinguish it from a legitimate later transition.
Keep that limitation explicit and test it. Do not hide it with timestamp heuristics
or label the model a lossless replica.

## Enumeration, absence and access

Pagination completion means an exhausted traversal under declared endpoint rules,
not a globally consistent inventory. Check limits, offsets, duplicates, malformed
records and contradictory totals; a short response alone is not a universal proof.
Partial/filtered results replace only their declared window. Never silently drop a
malformed row and advertise exhaustive coverage.

An empty accepted complete-scope snapshot clears that query's membership. It does
not erase all canonical entities. Verify previously established missing targets
through the appropriate direct endpoint before removing access/connections.
Classify applicable direct 403/404 as scoped unavailability, not physical deletion.
Timeout/5xx/decoder failure means verification failed. Unavailability fences pending
callbacks and cannot be reopened by pushes; direct and effective-role verification
must reestablish it. Preserve [the account contract](account-lifecycle.md), including
its current admission boundary, in this implementation.

A successful project creation or whole-project import may establish access to the
returned project only when the command ran under the same account epoch and a
currently mutation-authorized organization. This command-established access keeps
the current absolute deadline, is removed on account replacement, and is replaced
by the next authoritative access verification. It exists to admit the continuation
of the already authorized creation flow; ordinary observations never create access.

## Registration lifecycle and repair

One owner holds a lease on each desired interest. Identical descriptors share
registration and source state; distinct descriptors cannot collide. Releasing the
last lease stops local dispatch and cancels dependent work. Direct reads carry an
interest-generation abort signal through the HTTP adapter; final release, receiver
replacement and background pause cancel both active and queued direct reads. Do not fabricate an
upstream unsubscribe or rely on unknown same-name replacement/retention semantics.
Keep desired interests and actual wire registrations separately observable. Bound
both; receiver replacement and replay of desired interests is the conservative
fallback for registration churn. Never recycle another account's receiver.
Successful establishment resets that interest's recovery budget; the limit bounds
consecutive failed recovery attempts. A shared physical observation is admitted
once, using a still-current dependent selected when ingestion runs.

Native frames are the ordinary data path. A valid admitted update performs no REST
reread. Repair triggers are reconnect, foreground recovery, failed decoding/loss,
unresolved references and explicit refresh. Healthy receivers have no periodic
inventory, process or metric reread. Heartbeats test transport health; they do not
prove complete source delivery. A silent source omission with no observable fault
can remain until a new baseline or explicit refresh; `observing` retains its weaker
`source-order-unverified` meaning. A periodic full traversal cannot establish a
lossless stream and previously made account size multiply idle REST traffic.
Coalesce per scope and bound total concurrency. Search refresh every 160 seconds
in legacy is a client convention, not a measured subscription TTL.

Account inventory demands `organization-inventory` and `project-inventory`:
project/service updates and service membership, without process searches. Visible
topology and operation activity add their process demand; current metrics and
history have separate leases. Web and retained mobile candidate lists use the
same narrower inventory descriptor. The account's independent 14-minute access
renewal and absolute 15-minute deadline still apply; data traffic does not renew
access.

Operational constants live in one tested runtime policy module: HTTP, heartbeat,
open, greeting and registration deadlines; ingress bytes/events; hydration
concurrency; retained terminal processes; telemetry buckets; log lines; receiver
registrations; and background receiver lifetime. Their values are not part of public view
semantics. A budget breach is visible as partial/recovering/failed, never silently
discarded data reported live.

Keep ingestion and access deadlines independent of animation frames. Coalesce
publication to affected atoms; bounded log/metric rendering can use its own cadence.
Queued observations update the canonical model in order and publish in bounded
batches (at most 32 observations by default). An empty queue, control transition,
completion or ordering barrier flushes pending publication immediately, so receipts
never resolve ahead of the reactive read model. Inventory DTO consumers retain
snapshot identity when only canonical admission clocks changed; actual field,
membership, loading or error changes publish a new snapshot.
The bounded log-tail registry keeps signed grant expiry and failed grant acquisition
scoped and retryable.

The resource broker rechecks dynamic account, organization, project/service scope
and absolute deadline on acquire and retry. Reconciliation or deadline expiry
releases all affected leases, aborts source work and erases public retained values.
The build-log registry checks the same access window on reads, callbacks and retry;
revocation or expiry cancels transport work, erases retained lines and notifies readers.
Its last-lease rule spans grant acquisition, page load and follow transport.
Adapter-only secrets, signed URLs, raw DTOs and raw
errors never appear in public snapshots or diagnostics.

Compound commands recheck admission before each write. Once any write may have
been accepted, a later admission, transport, decode or platform failure is reported
as non-retryable uncertainty rather than an invitation to replay the workflow.

## Consumer data parity

`data/dto.ts` is the shared bridge from canonical Project, ServiceStack and Process
records to the existing presentation models. Web inventory, topology, activity and
web/mobile candidate discovery use it. Keep one mapping per entity so a client
cannot silently lose fields that another surface still needs.

- Project organization IDs come from the scoped ref. Preserve creation time,
  tags/description, mode and routing placement for grouping, provisioning and origin
  matching. Access overrides (`userRoles`) are separately verified admission evidence,
  not permission inferred from a presentation DTO.
- Preserve service `isSystem`; existing topology, public-route offers and environment
  summaries exclude system services. A system `core` must not become a user service
  because its flag was dropped. Zcp identification uses its type; the current Mate
  and its authorization belong to the exact service ID.
- Preserve runtime version, effective autoscaling and active deployment metadata.
  Deployment age prefers `activeAppVersion.lastUpdate`, then `created`, matching the
  original presentation reader.
- Current CPU is **dedicated `cpu` plus shared `vCpu`**, summed across containers.
  `cpu = 0/0` on a shared service does not mean zero allocated cores. Keep RAM/disk
  units as GB. An observed empty query is distinct from a query not yet answered.
- Visible topology owns an optional history lease for the last 24 hourly buckets
  in the browser time zone. Bind history atoms as well as current usage atoms;
  order corrected buckets by time before plotting. Metrics remain optional to
  topology availability and use native updates, with no added polling timer.
- Process `appVersion.build`, `prepareCustomRuntime` and `activationDate` retain
  their original nested shape. Reuse the total activity reader at the adapter
  boundary; invented flat pipeline fields lose step timestamps and build-log IDs.

Regression tests compare decoded REST/native data, reducer state and consumer
projections with the original topology/activity/route/summary readers. Isolated
tests of a newly invented DTO do not establish migration parity. Recipe/export,
location and authorized-agent resources still reuse their existing value readers
behind the scoped resource adapter; token grants omit credentials. Authentication,
admission verification and container health keep their distinct owners.

## Adapter admission and evidence

For each source, record endpoint/registration descriptor, sanitized fixture,
declared field ownership, null/omission/array behavior, snapshot/delta shape,
pagination/coverage, revision evidence, unavailable errors and recovery behavior.
Unknown optional fields may be ignored; malformed required identity/state changes
degrade that interest. Unknown frame types need diagnostics without raw credentials
or arbitrary payload logging.

Search and direct DTOs are different inputs. The production proof exercised native
ServiceStack and Process data plus a current metric through the actual runtime.
Regression coverage retains multiple consumers, external initiation, read/push
races, terminal failure/cancellation, receiver replacement, optional failure, late
work after logout, sustained load and registration churn. Synthetic reducers alone
do not establish rendering performance or backend guarantees.

Current/history metrics have separate semantics. Legacy current stats consumes
`data.items`; history consumes `data.update` with window metadata. No generic entity
merge can stand in for window/bucket correction. On 2026-09-07 a read-only probe
found history `groupBy: serviceStackId` rejects the legacy `billingEnabled` filter;
removing that filter succeeds. Verify current platform behavior instead of copying
legacy requests verbatim. See the dated [ledger](verified.md) for measured scope.

The stable decisions above do not depend on proving global source ordering.
Unsupported field or metric semantics block the affected adapter's cutover;
they do not authorize replacing the architecture with query caches. Changes to
source ownership, access policy, public state meaning or the command/observation
boundary require architecture review before parallel implementation continues.

New adapters must add total decoding and sanitized fixtures before their data can
reach a reducer. New retained resources must prove final-lease cancellation,
revocation/expiry erasure and late-completion fencing. New projections must prove
that unrelated entity changes do not publish. New commands must cover rejection,
uncertainty and any returned observation/process identity through the shared model.
