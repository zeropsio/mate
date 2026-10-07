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
gap. The origin key survives a home wipe for the same registration/provider; its new writer/ledger
must reconcile with HQ rather than import the same history under another counting identity.

Codex uses its native session identity and inclusive cumulative total as one replaceable segment.
The first sample of a non-fork session is retained. A decrease freezes that counter pending lineage
proof; surpassing the previous high-water later never invents a reset generation.
A new native session is a new counter; forked history and child counters with unproved parent
overlap stay excluded pending lineage proof. Model
switches leave model allocation unknown. Counter times remain intervals or undated, so HQ does not
invent daily allocation. Claude cache categories retain unknown components. Reported single cache-write durations use
HQ's standard/fast 5-minute or 1-hour bands; unknown or mixed durations remain unpriced; reasoning is never added to output twice. Neither meter declares historical completeness,
settled cancellation coverage or inferred run/actor provenance. Grok, Cursor, OpenCode and
Antigravity publish unsupported meter coverage, including configured disabled instances.

Startup reconciliation, transcript filesystem changes, settings changes and provider runtime events
(`session.started`, `turn.completed`, which both conversation engines emit) drive capture. A
transcript directory that does not exist yet is awaited from its nearest existing parent; a watcher
that errors is replaced after a growing delay. The
first retained import declares backfilling before reading; its durable marker prevents repeated
backfill declarations. Subsequent reads continue from source checkpoints, one 1 MiB chunk per
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
source-checkpoint rollback and corrections. Existing HQ-link tests protect overview/attention.
