# HQ recorded agent usage

Capture protocol 1 and report protocol 1 are independent additive capabilities. HQ advertises
capture and the HQ-issued Mate registration lifetime (`usage.mateId`) on the existing link's
`state` frame, and `agentUsage: 1` beside the navigation protocol in `scope-ready.core`.
An answered older declaration without the field means unsupported; an unanswered declaration
means unknown. Clients must negotiate before sending the `agentUsage` scope. Old overview,
attention and opened-Mate Limits remain independent. Mobile reporting is deferred.

## Capture and identity

`packages/contracts/src/agentUsage.ts` defines disjoint consumption facts and coverage;
`packages/shared/src/agentUsage.ts` defines hello, journal, ACK/replay and pinned snapshots.
Native identity is namespaced by a registered origin bound to organization, execution project,
HQ Mate registration lifetime and writer lineage. A new process, login or ledger UUID is not a
new consumption identity. HQ refuses a new ledger claiming an existing origin without explicit
lineage reconciliation. Another organization's or project's source cannot be relabeled.

Counts and revisions use checked decimal strings, not JavaScript floating point. Components
are disjoint; reasoning is a subset of output, and an inclusive total is an alternative to an
incomplete split. Unknown components remain unknown. Unregistered authorized Mates appear in `captureGaps`; invisible Mates do not. Undated/interval evidence is retained as
unallocated and makes relevant reports partial. It is never assigned to a guessed day.

A journal entry is an atomic transaction group: coarse retraction and detailed replacement must
be together. At most 100 facts/entries and 48 KiB per usage frame, within the link's 64 KiB bound.
Canonical SHA-256 digests chain entries; one committed contiguous cursor is ACKed after commit.
Unknown frames remain tolerated. A malformed usage lane never destroys overview/attention.

Every socket receives a fresh process-bound opaque sender fence. Admission and each write lock
the execution project and check the still-live credential in the leader transaction. Replacement
or revocation serializes with commit. A new socket can fence an old sender, answered with the
`fenced` disposition (`channel_replaced`, `hello_required`), never `refused`; a high-water or digest
conflict refuses the lane rather than electing a divergent clone. Hello returns HQ's actual cursor,
even after restoration. Gap/replay errors never advance it. Interrupted pinned manifests must resume with the same page identity or use `usage-snapshot-abandon`; accepted contributions survive abandonment. Snapshot pages use idempotent upserts
and explicit tombstones, not deletion by absence; progress, page count, fact count and pinned
manifest digest are checked before committing H. Published incomplete pages remain recovering.

## Permanent accounting and recent detail

Migration `0048_agent_usage.sql` adds permanent origins, receipts, native aliases, tombstones,
daily source/model/price-band/meter/known-component cells, coverage, producer cursors and prefix digests. None cascades
with live Mate/project/application rows. Deleting a Mate retires its stable registration and
records last application placement. Recreating that project cannot attach the old lifetime.

One leader-fenced transaction replaces the receipt and subtracts its old contribution before
adding the new one. Same revision/content is a no-op; older revisions cannot replace newer
facts; same revision/different content refuses the lane. Retraction leaves a permanent zero
contribution receipt. Late facts, redating, model changes and corrections still work after
raw expiry. Arithmetic overflow, negative cells and damaged evidence fail instead of clamping.

Exact detail targets 30 days, with a UTC boundary backed by actual retention. Daily cells cover
all ages, including recent days, and never age out. Whole-day reports use daily cells exclusively;
recent subday edges replace their whole-day cells with exact facts. Edges before exactSince are
unsupported, never interpolated. All-time reports mean all recorded evidence, with explicit
unknown history and source gaps. Neither an empty query nor a connected socket proves zero.

`usageRetention.ts` provides consistent permanent-tier checkpoints, independently restored-cut
verification and bounded pruning. An ACK or successful dump alone is not protection. Operators
must restore an independently stored checkpoint and compare its permanent cut before registering
protection. Retiring raw facts are schema-checked, re-normalized and matched to their receipt revision/digest/contribution before deletion; permanent receipts and daily/native-cost cells must also reconcile. New accounting
writes pin retiring evidence until another cut is protected; unavailable protection leaves raw
rows retained and the report's retention status pinned. Undated and future-dated raw evidence also expires by ingestion age after protection; reliable recent redating keeps its exact detail, so an unreliable occurrence clock cannot defeat the detail policy. Each deletion batch is bounded, and the
materialization boundary commits under the same lock as ingestion. A restore marks history partial
and clears sender/protection authority; deleted/post-backup sources cannot be rediscovered by
looking at today's live Mates. Protect and restore the complete database plus required subsequent
recovery evidence as a unit, never totals without receipts or receipts without totals.

The downgrade floor for serving/capturing this ledger is capture/report protocol 1 and migration 0048. Older leaders may still serve their original surfaces and ignore the additive tables;
they must not ingest or prune this ledger. Recovery tooling must understand migration 0048's
routines and restore marker before replacing a database that contains it. Release integrators
must verify independent recovery protection and production sizing before enabling expiry.

## Authorized report scope

`agentUsage` is demanded on the existing HQ scope socket. Navigation contains only its capability,
not usage history. Reports compute from one repeatable PostgreSQL snapshot, joining the current
canonical owner and application for each stable live Mate. Initiators, credential owners and
historical chargeback are not inferred. Retired rows have no current owner and expose last placement.

Live sources require `observe_mate` on their execution project, even inside a visible application.
Retired/deleted sources require ACTIVE membership in the original org and org READ_ONLY or higher.
A project-only grant, unknown role or non-active membership is insufficient. Missing from a viewer's
listing does not prove deletion. Every filter, coverage row and page uses the same admitted sources.
Unknown/inaccessible selectors are refused without membership disclosure. Access/grouping changes
rotate the report replay lineage; correction/access/price generations invalidate detail cursors.
Unrelated activity-only attention does not recompute usage; owner changes do.

Summaries use server grouping with at most 200 groups/coverage rows and explicit truncation flags.
Detail uses bounded keyset pages (100 rows), with cursor generations and no browser-held database
transaction. Exact requests are limited to the retained window; lifetime daily drill-down persists.
No exact lifetime distinct-session count is promised. Reports do not create Mate sockets.

Automatic API-equivalent prices use exact published model IDs, a named immutable rate/policy
revision and retained base statistics. Explicit supported fast/cache-duration bands are priced;
unknown models, missing components/rates and unsupported modifiers remain unpriced. Native cost
is retained separately by currency, basis and decimal scale. Fetch failure retains the last usable
policy, never a fully priced zero. Legacy Mate price overrides and Limits are unchanged.

## Retention operation and measured budget

`node dist/main.mjs usage-checkpoint` prints the current permanent-tier cut without changing it.
For expiry, stop Core, restore an independently stored complete backup into a separate PostgreSQL
database, and set `HQ_USAGE_RESTORED_DATABASE_URL` in the operator environment. Then run
`node dist/main.mjs usage-protect-prune <independent-set-id>`. It refuses an active Core, a self URL,
a mismatched restored cut or any intervening accounting write. It registers protection and removes
raw rows in bounded transactions to the UTC 30-day boundary. The protected set is exempt from backup
rotation/quota eviction; new backups can proceed when space permits. Restart Core afterwards.
URLs and credentials are never command output. The operator must retain the independent set; this
command verifies its restored accounting cut, not independent storage durability. An unverified or
moved cut pins raw detail and appears in report retention metadata. Restore remains partial until
required recovery evidence establishes the missing history and source universe. Reports impose a
10-second statement deadline: expiry is a transient scope failure, never a zero result.

A disposable PostgreSQL fixture on 2026-10-07 loaded 39,000 normalized facts (1,000/day for 39 days)
and 156 daily cells (four models/day). Allocated relation sizes include each table's indexes:

| Tier                                        |      Bytes | Allocation per fact/cell |
| ------------------------------------------- | ---------: | -----------------------: |
| Exact facts                                 | 33,644,544 |             862.7 B/fact |
| Permanent receipts                          | 25,509,888 |             654.1 B/fact |
| Permanent aliases                           |  5,447,680 |             139.7 B/fact |
| Daily cells                                 |    180,224 |           1,155.3 B/cell |
| Permanent journal prefixes (one entry/fact) |  5,537,792 |            142.0 B/entry |

The 100-row daily page plus summary was 35,645 bytes, with a 56-row final page. Five warm summary
reads measured 21 ms p95 in that run; this is a synthetic local observation, not a production SLA.
The report uses three summary reads (cut/policy, authorized source inputs, grouped cells), plus one
indexed keyset read for detail; the latter fetches at most 101 rows. Lifetime receipt/alias growth
is O(facts): at the reference volume, approximately 327 MiB/source-year including daily cells,
or about 224 GiB/year for 700 such sources, before WAL, backups, old price policies
and operational headroom. PostgreSQL storage is separate from the Mate's proposed 256 MiB capture
budget; this HQ fixture does not measure the Mate journal or snapshot reserve. Production p95
volume and independently verified recovery protection remain release-enablement checks.
