# Client data layer

Remote facts have one path: **source adapter → reducer → account store → projection → surface**.
The shared implementation belongs in `packages/client-runtime/src/data`; web and mobile use it,
and desktop uses the web client. Provider evidence enters through the [provider runtime SPI](spi.md).

## Ownership

Each fact has one authoritative source and one writer in the client. Facts are keyed by domain
identity, within the verified account's lifetime. Remote values and verdicts stay in account memory;
browser storage holds local preferences, drafts and sign-in state under their own contracts.
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
Partial evidence cannot replace a complete record or prove its absence. Distinct read purposes
keep distinct identities. Releasing a view releases its demand; ending the owning account closes
its observations before disposing their state.

Share account-wide observations. Hold detail only while a consumer or an accepted operation
needs it; share demand and release it at the last holder. Use the source's realtime
contract where available. A sampled source declares its demand and freshness policy centrally;
components never add independent fetch, polling or recovery loops.

Projections are pure functions over keyed facts, source coverage, access and operations. Surfaces
read projections, express demand and submit intents. They do not own a second remote cache, infer
person facts from credentials or substitute clock order for source order. Retry policy belongs to
the shared stream supervisor. Automatic recovery is visible and bounded in rate while demanded.
Every wait has a deadline or names its next action. A definitive refusal stops automatic recovery
and waits for changed input, changed access or an explicit retry.

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
