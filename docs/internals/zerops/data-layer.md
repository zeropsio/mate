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
account lifetimes. Scope a damaged or refused read to the evidence it affects. A scope is current
by its own baseline on an open connection; another scope still reading on that connection holds
nothing back. Keep known values
through transient failures; withhold protected values when access is unverified and purge them on
an authoritative denial.
Whole-value replacement requires complete evidence for that identity; partial input preserves
unproven values. Replaceable observations keep distinct identities by owner and purpose. Releasing a view releases its demand; ending the owning account closes
its observations before disposing their state.

Share account-wide observations. Hold detail only while a consumer or an accepted operation
needs it; share demand and release it at the last holder. A view's demand opens when the view is
shown and never while it is only rendered: React may hold a render or throw it away. Forgetting returns released detail to
unknown; it never claims deletion. The last release forgets detail unless its family declares it
kept for reuse (a return, a remount, a sampled freshness); the account's end forgets the rest.
What a release keeps still reads as read: a holder that let a read go on what it said never finds
it unread and takes it back, which would read it again on every answer.
Losing a link is not a release. A read asked afresh is answered only by a read begun after the
ask; what the scope held before, live or not, is not its answer. A producer of a pushed value (a Mate's overview through HQ)
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

The viewer's link to an organization's HQ is one value, derived once (`hqLink`): live, restarting since
(the stream ended as planned and the next did not open), or unreachable since. The menu's header says
it, and only past its budget (longer than an HQ deploy); a route waiting on HQ quotes the same line.
No other surface reads HQ's stream status to decide what it draws of what HQ said; only HQ's refusal,
its own answer, is said at once. HQ being away is never evidence about a Mate: a row keeps what HQ last
said, and changes only on an affirmative observation (a live HQ's verdict, the Mate's own socket).
Controls that need HQ stay as they are; a write while HQ is away is answered at once that it is away,
never queued. A wait for fresh HQ evidence (an accepted write's settlement, a birth's end) waits for a
live HQ.

An ordinary New project submits one birth intent to HQ. The HQ client adds the person's Zerops
access token and its expiry at send. An HQ operation runs on that token after the request ends, and
Zerops revokes it when any page of the session renews the session, up to 30 minutes before its
expiry; so the press hands an operation a token with at least an hour left, renewing the session
first when it has less, as after a 401 (a refused renewal ends the session, an unreachable one fails
the press, and nothing reaches HQ). Hand-over, take-over and HQ's door finish within the request and
carry the current token as is. A birth's progress is HQ's `operation`, which every surface reads
through navigation from any device; after the intent the client only reads it. A token Zerops
revokes anyway (a sign-out, a rotation elsewhere, a lapse) stops the operation with `token_expired`,
and it waits for its maker: their Continue hands a token the same way, and no surface continues it
otherwise.

The menu draws one tree made of HQ's records only (`menuTree`): HQ's applications are its groups,
their environments, placed projects, Mates and open births their members and, as their presses, the
stages and productions HQ holds a setup press of and lists no project of yet; its Mates and births
in no application are the ungrouped ones, its Chiefs placed by HQ's Chief fields. Add environment, Put it
live and New Mate read their group from it as the menu and the projects page do. Each member is joined by
project id to the person's Zerops roster, which adds facts and never removes a member. A birth and
the Mate born of it are one member under one key, the birth's id, from its first frame on. A roster
project HQ names nowhere and without HQ's birth tag is a Platform project. Every order is HQ's own
times; nothing of the tab's own state (a press, its clock) adds, keys or orders a row. The menu
paints at HQ's first answer, never waiting on the roster or a timer; with HQ unreachable on a cold
load it shows no project rows and says so.

A route's wait for its conversation is such a wait. Its opening (the Mate's wordless "opening the
conversation") ends by a deadline in the conversation, in a cause the route already says, or in the
opening's end: why (its Mate not answering, the conversation not found yet, or gone) with Try again where
it may still come and the way back to the projects. `packages/client-runtime/src/zerops/environments/gate.ts`
owns the end (`OpeningEnd`, `openingEndPhrase`) and when the route gate's deadline runs; the thread route
(`apps/web/src/threadRoutes.ts`) ends its own wait for a thread nothing names through the same end.

Changed access is heard in one place, `packages/client-runtime/src/data/accountRuntime/accessChanges.ts`:
the person's membership and their effective role on each project, as the client's own Zerops socket
keeps them in the store. HQ filters each read by the projects the person's token reaches and reads
only when asked, so a move between two readings has HQ read again by one `subscribe` the navigation,
each organization-wide scope and each held scope of the moved projects, each asked whole without its
cursor, so HQ answers with a baseline that restores what a denial withheld (a scope asked again is a
fresh read; `retry` answers only HQ's own `scope-changed`), and the Mate adapter ask a Mate it
refused again. One change of the person's access is one `subscribe`: a reading is taken only when
none of its reads is under way (their membership, the project roster read whole, a listed project's
absence verified), so whichever order they land in, one change is one reading; HQ reads Zerops after
the change committed, so the roles the client's catch-up reads give later are not news. Their
membership is read on their own `client-user` frame and under the next registration after every end
of a Zerops attempt, the adapter's own end on a refusal of access included (Zerops replays nothing
pushed while no socket was registered), never on a cadence. A refusal that ends the attempt leaves
that read under way, so no reading is taken from the old membership. A Zerops frame that moves
nothing of the person's asks nothing. A removal from the organization is heard as the person's own
membership leaving (a `client-user` list `delete`), which reads their membership alone; it answers
none. The person's organizations, read from that same membership, no longer hold it, so the web
moves to their next organization (or to none) and closes that organization's HQ stream itself
(1005); HQ ends nothing.

Whether HQ ended a person's access has one verdict, `accessEnded` in
`packages/client-runtime/src/zerops/hq/accessEnded.ts`: the session ended, the scope is denied,
or neither. The HQ client and every adapter read it, never HQ's codes. On a session ended the HQ
client forgets it and renews it through the door once per call, one renewal per held session;
a denied scope purges that scope's facts; neither keeps them. A stream closed `4401` only forgets
the session. A Mate's socket closed `4401` asks HQ for a new ticket at once, and only HQ's answer
says what follows: a Mate's close code never signs anyone out.

## Where a verdict lives

A verdict is a domain answer: who owns, who may act, what is offered, where a change stands, what a
Mate is doing and whom it waits on. Each is computed once, in the layer its inputs come from: over
the account store, a projection in `packages/client-runtime/src/data/projections`; over values, a
pure rule in `packages/client-runtime/src/zerops` or `packages/shared/src`; over what only this tab
holds (a press it runs, a draft), a module in `apps/web/src/zerops` beside that state.
`apps/web/src/zerops` otherwise only wires verdicts to the tab: atoms, hooks, the tab's stores.
A `*.logic.ts` under `apps/web/src/components` shapes one surface's view from verdicts it is handed:
order, folding, tones, sizes, that surface's own words. It decides nothing a second surface needs;
an answer or a sentence two surfaces need is a verdict and moves down, with its words.
Imports run one way: `components/` → `apps/web/src/zerops` → `packages/client-runtime` →
`packages/shared`, never back. `t3code/no-upward-components-import` holds the web half with no
exceptions. Inside the client runtime `data` imports `zerops` and never the reverse:
`t3code/no-upward-data-import` holds it with no exceptions.

A conversation's code folder is its leased checkout, then its worktree, then its workspace, as
`conversationCodeFolder` in `packages/client-runtime/src/zerops/gitTab.ts` decides.
A reply's relative path is read from the code folder, while an absolute path names the file read
from the workspace root when inside the Mate's workspace or from the conversation's write record
when outside, so `contentContract.ts` tells the agent to write absolute paths.

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
