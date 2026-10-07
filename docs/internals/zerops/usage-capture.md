# Mate usage capture

The Mate server owns normalized provider evidence in `<stateDir>/usage.sqlite`, beside its
orchestration database. The existing authenticated HQ socket carries a separately negotiated
usage lane. Browser demand never starts a ledger scan or opens another Mate socket for capture. Execution does not
wait for HQ ingestion.

## Identity and capture

HQ's capture capability supplies the registration lifetime (`mateId`) and the org (`orgId`); the
Mate never reads Zerops for either and captures nothing while an older HQ leaves the org out. It
freezes org/project/lifetime in the source registry. A home copied into another project or
registration cannot export its inherited facts. An existing bound home resumes capture on startup
in its own project, independently of HQ availability.

Each provider's container history is one origin, including multiple configured homes. Claude
native response identity deduplicates repeated blocks and inherited/copied transcripts; a later comparable
position in the same transcript can correct a response. Incomparable conflicting copies produce a
gap. A record seen under more identities over time (an Antigravity generation) keeps the fact it was
first captured as: its identities resolve to that one, and a change is its next revision. Each
ledger mints its own origins. A new registration, or HQ refusing the ledger's lineage
(`ledger_rollback_conflict` after a restored `usage.sqlite`, `origin_lineage_conflict`, a binding or
prefix conflict), starts a new ledger that captures from that moment: the old journal, facts and
positions go, so nothing grows behind a stopped lane, and the gap between stays unknown. A link
renews at most once; a lost `usage.sqlite` is simply a new ledger.

Codex uses its native session identity and inclusive cumulative total as one replaceable segment.
The first sample of a non-fork session is retained. A decrease freezes that counter pending lineage
proof; surpassing the previous high-water later never invents a reset generation.
A new native session is a new counter. A fork or spawned child counts from the total its copied
parent history ends at (the counts within 1 s of its first meta) and names that parent session as
`parentId`, as a Claude sub-agent (`agentId`) names its parent's. Model
switches leave model allocation unknown. Counter times remain intervals or undated, so HQ does not
invent daily allocation. Claude cache categories retain unknown components. A cache write is `"0"`
only where the provider has no cache-write meter at all (Codex without the field); a meter that
leaves a value out is unknown. Claude reasoning is its `thinking_tokens`, unknown without them. Reported single cache-write durations use
HQ's standard/fast 5-minute or 1-hour bands; unknown or mixed durations remain unpriced; reasoning is never added to output twice. Neither meter declares historical completeness,
settled cancellation coverage or inferred run/actor provenance. Grok, OpenCode and Antigravity are
captured too (a database record's position is its file, its ordinal the scan); Cursor, whose only
source is an account-wide API, publishes unsupported meter coverage, even for a disabled instance.

Startup reconciliation, transcript filesystem changes, settings changes and provider runtime events
(`session.started`, `turn.completed`, which both conversation engines emit) drive capture. A
transcript directory that does not exist yet is awaited from its nearest existing parent; a watcher
that errors is replaced after a growing delay. Capture
begins at HQ's first offer and nothing is backfilled: a Claude transcript on disk then is
checkpointed after its last record, a Codex session's total then is the baseline its later totals
count from, and a record dated before it is never a fact. Reads continue from source checkpoints, one 1 MiB chunk per
transaction, with no size cutoff; a reconciliation admits at most 2,048 files. The 64 KiB before a
checkpoint guard a resumed position (a rewrite before them goes unnoticed); a source change during
parsing rolls back its facts/checkpoint. Records over 32 MiB, damaged records, incomplete listings,
rewrites and unreadable sources remain explicit gaps. File deletion never retracts consumption.
These are IO admission limits, not proof of an empty or complete period.

SQLite's write lock is acquired before reading the source checkpoint. Native meter position,
canonical replacement, local revision, gap-free sequence and chained digest commit together.
Multiple processes sharing the actual home therefore serialize source parsing and cursor writes.
Checkpoint loss never deletes previously recorded consumption. No transcript, path, login, email,
prompt, output or credential is exported in the normalized facts.

## Replication and recovery

A successful versioned state handshake enables hello; legacy HQ links get no speculative usage
batches. Source wakes and socket receipts serialize on the same lane, including snapshot negotiation.
HQ returns its actual cursor/digest and a fresh channel. Facts and coverage from a source added after hello require a new source declaration before export.
An unavailable HQ (`transient`) is asked again
after 5 s, doubling to 5 min; a `fenced` lane stops quietly and the newer link's hello reopens it.
A cursor ahead of the local cut, or a conflicting known prefix, stops only this lane. Prefix digests survive journal compaction,
so a copied divergent ledger cannot hide a known branch conflict behind an expired journal.

Batches contain at most 100 entries and 48 KiB, with one logical batch/page in flight. The current
immutable frame can be resent on source changes or the existing HQ ping after the pong. ACK loss
therefore does not require a socket failure. Replacements and native identities make replay
idempotent. ACKs must match the ledger, active channel and in-flight cut. Stale ACKs cannot compact
new work; the restored HQ's lower committed cut supersedes a previously saved ACK.

When HQ requests repair, one immutable snapshot at H is pinned as bounded pages in SQLite.
Its page-chain manifest, canonical facts, tombstones and coverage survive a process restart.
A reconnect repeats pages idempotently; HQ retains page progress. Only the final validated page
ACK commits H locally, releases the snapshot and allows H+1 replay. Snapshot absence never retracts
HQ's permanent facts. Canonical corrections arriving after H cannot modify pinned pages.

## Storage and release boundary

The 256 MiB local soft budget includes allocated SQLite pages, WAL and a proposed snapshot reserve.
Four MiB is reserved for bounded capture-loss metadata. Capacity pressure refuses capture or
snapshot admission and preserves prior evidence. A truly full or broken disk may prevent even a
loss marker; an unsealed source remains partial after recovery.

ACKed journal bodies can be compacted after the durable ACK. Canonical facts, tombstones,
checkpoints and prefix evidence stay pinned: the current capture protocol has no independently
protected HQ prune watermark. An ingestion ACK is not a backup receipt. Raw pruning must wait for
that explicit protection/reconciliation contract; it must not use a Mate clock or silently shorten
HQ's advertised exact window. Production sizing and protected pruning remain release checks.
The SQLite tables are additive and retain identities/meter versions through upgrades.

Desktop inherits web transport and needs no separate capture. Mobile stays on its existing usage
path for now; this server change does not modify shared client behavior or mobile contracts.

Focused proof lives in `apps/server/src/usage/usageLedger.test.ts` and `usageCapture.test.ts`: ACK
loss/replay, bounded paged repair, restart, copied history, binding/prefix conflicts, counter resets,
source-checkpoint rollback and corrections. `apps/hq/src/usageEndToEnd.test.ts` runs the Mate's
ledger, meter and lane against a running Core on Postgres (a dropped link, a restart, a fenced link,
a snapshot, a restored and a lost `usage.sqlite`) in the regular `apps/hq` test run. Existing
HQ-link tests protect overview/attention.
