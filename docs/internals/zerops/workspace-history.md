# Workspace history

Mate observes work across independently mounted Zerops services. A working directory is not a
service identity, and the presence of Git does not prove that deployed files are original sources.
zcp continues to own provisioning, adoption, mounting, delivery and Git preparation. Mate reads
existing workflow context; this feature neither reads nor rewrites raw `.zcp/state`.

## Capture and identity

A verified working root binds project ID, service ID and remote directory. Hostnames and mount
paths are addresses. Kernel mount records supply current candidates; bounded SSH inspection
verifies the named identity fields. Checkpoint execution carries its binding through the entire
Git operation and checks identity on the remote machine. Historical operations can therefore
work after unmount, and cannot silently execute against an empty local mountpoint or a replacement
service with the same hostname. Verified remote checkpoints bypass local VCS configuration probes.

A fresh request awaits a durable preparation attempt before the provider can perform user work.
The capture journal is keyed by the durable request ID and records actual before snapshots; neither
HEAD, the previous turn's end nor zcp's technical empty seed replaces them. Follow-up input during
continuous execution joins the existing capture interval. Superseded provider turns have no separate
proven end. Finalization persists exact per-root outcomes before a subsequent idle request proceeds.
Cancellation releases pending receipts, and restart never reconstructs an old baseline from today's
files. Differences describe observed changes, not exclusive authorship by one agent.

Snapshot objects remain in the owning Git repository under immutable, parentless, hidden refs:
`refs/t3/checkpoints/<thread>/runs/<request-hash>/<root-hash>/before|after`. Capturing preserves
application HEAD, branches, the user's index, remotes and Git identity. All temporary indexes and
cleanup run on the service. Capture uses a validated NUL-delimited path set, supports unborn and
shallow/detached repositories, and checks content before writing objects. Initial limits are 10,000
paths, 1 MiB of path names, 8 MiB per file and 64 MiB total input. Unsupported layouts, filters,
dependency trees and changed selection rules are explicit limitations, not silent exclusions.
Directories without Git remain visible but are not initialized for history.

## Persistence and review

Completed checkpoint events and projections carry bounded metadata: root identity, exact snapshot
OIDs and ref locators, capture intervals/outcomes, representation/policy and optional file statistics.
The write-ahead journal preserves preparation/finalization attempts independently of worker life.
Patch bodies do not enter events, projections or thread-list WebSocket messages. No secondary patch
archive or automatic origin recovery is used.

Detail requests select historical membership and exact OIDs, optionally guard the expected run ID,
and resolve each service independently. A moved ref cannot replace the recorded OID. Missing Git
objects, unreachable sources, unsupported content and oversized responses differ from a successfully
computed empty diff. Web and retained mobile source show per-service loading, retry and failures;
one unavailable service leaves other details usable. Detail output is bounded to 2 MB per request.
Legacy summaries lack service-instance identity: their saved paths narrow best-effort reads and their
coverage remains explicitly unknown.

A CI deployment may replace `.git` and remove checkpoint objects. The conversation and saved summary
can survive while its detail is unavailable. No automatic fetch, unshallow, hidden-ref push or new
retention/GC job is introduced. Thread deletion attempts cleanup only on validated recorded roots.
Workspace-history restore is refused until exact membership, current-content checks and partial
failure recovery have a separately reviewed design; a partial restore must never rewind conversation.

## Verification

Focused tests cover real Git content/identity preservation, limits and retries; preparation receipts,
continuous input, cancellation and restart; SQL projection replay; historical membership and per-root
client outcomes. Disposable Zerops integration additionally exercises the full checkpoint store,
registry and SSH executor against app/API services, SQLite reopen, physical unmount and mismatched
service identity. Production zcp provisioning and deployment behavior is unchanged.
