# Client data layer

Remote facts have one path: **source adapter → reducer → account store → projection → surface**.
The shared implementation belongs in `packages/client-runtime/src/data`.
Provider evidence enters through the [provider runtime SPI](spi.md).

## Ownership

Each fact has one authoritative source and one writer in the client. Facts are keyed by domain
identity, within the verified account's lifetime. Remote values and verdicts stay in account memory;
browser storage holds local preferences, drafts and sign-in state under their own contracts.
A family may declare a display label safe to retain after deletion or denial.
A remembered value grants no access. Each write is authorized by its owner when it runs.

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
unknown; it never claims deletion. The last release forgets detail unless its family declares it
kept for reuse (a return, a remount, a sampled freshness); the account's end forgets the rest.
Losing a link is not a release. A producer of a pushed value (a Mate's overview through HQ)
sends it only when what it says changed; the time it last looked is no change. Use the source's realtime
contract where available. A request stays within the source's per-request bounds, declared once
beside its wire schema; a longer list goes as several requests. The change notices read together are answered by one
ask, so the source shares that ask's reads among them. A sampled source declares its demand and freshness policy centrally;
components never add independent fetch, polling or recovery loops. A value its family reads once
is read again on our own write, the person's again, or a pushed row that says it changed, never on
a cadence in case it did.

Projections are pure functions over keyed facts, source coverage, access and operations. Surfaces
read projections, express demand and submit intents. They do not own a second remote cache, infer
person facts from credentials or substitute clock order for source order. Retry policy belongs to
the shared stream supervisor. Automatic recovery is visible and bounded in rate while demanded.
Every wait has a deadline or names its next action. A first answer awaited on a connection
that holds may be bounded by that connection's liveness instead: a source still working there is
slow, not down, said as slow and never asked again meanwhile. A definitive refusal stops automatic recovery
and waits for changed input, changed access or an explicit retry.

Changed access is heard in one place, `packages/client-runtime/src/zerops/account/accessChanges.ts`:
the person's membership and their effective role on each project, as the client's own Zerops socket
keeps them in the store. HQ filters each read by the projects the person's token reaches and reads
only when asked, so a move between two readings has HQ read again (`retry`) the navigation, each
organization-wide scope and each held scope of the moved projects, and the Mate adapter ask a Mate
it refused again. A Zerops frame that moves nothing of the person's asks nothing. A removal from the
organization pushes nothing, so it is heard only at the next read of their membership.

## Writes and evidence

Record an operation and its identity before sending. Acceptance, reflection in observed facts and
completion are separate states. An accepted operation retains its observation demand after the
originating surface closes. A write whose answer names the value as it stands after it commits
that answer, ordered after every read begun before it, and reads nothing again. Operation predicates stay pure; adapters and executors own remote I/O.
What a surface offers is decided by one pure rule per verb, mirrored from the owner that enforces
it: verbs HQ answers in `packages/shared/src/zeropsPermissions.ts`, Zerops' own writes beside their
domain in `packages/client-runtime/src/zerops` (team roles in `teamRoles.ts`, project access in
`projectAccess.ts`). Surfaces call the rule, never restate it; the owner's refusal at the write wins.

Resolve a lost answer by its original request identity, handle or uniquely attributable owner
evidence. Never blindly repeat a write that may have been accepted. A disappearing process or an
observation deadline cannot manufacture success or failure. When the outcome cannot be recovered,
retain an unresolved receipt naming who acts next and what they can do.

New families, projections and operations use these same boundaries. Replacing an input preserves
every existing product test sentence and follows all affected clients. Keep source-specific wire
shapes, policies and surface behavior in code and tests; platform assumptions belong beside the
code that depends on them or in a short ledger with a verification command.
