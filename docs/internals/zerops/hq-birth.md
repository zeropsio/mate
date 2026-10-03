# HQ birth across browsers

An org Owner or Admin's first visit still starts HQ automatically. Other members are told whom to
ask. The gate has no setup button. A failed step stops with a reason and **Again**; discovering a
failed birth in another browser does not retry it.

The former implementation's record was account-local storage (`apps/web/src/zerops/hqBirth.ts`,
base revision line 83), guarded only by Web Locks (line 115). The gate passed that record to the
runner (`ZeropsHqGate.tsx`, lines 37–43). Another browser had neither it nor the lock; the runner's
`assertNoHqUnderway` rejected the existing project with “Finish it where it started” (`hq/birth.ts`,
base revision line 357). Those paths are removed.

## Record

The nascent HQ project's **plain project env** owns the journal. Tags identify the project and
birth only. Tags replace the whole list on PUT, have a 65,534-byte JSON budget and provide no
compare-and-set. Project env keys are unique case-insensitively, so POST can reserve an immutable
slot without racing an overwrite. These are the measured properties in [verified.md](verified.md),
“Project tags as the grouping mechanism”, “Isolation flipped live” and “The HQ rebuild, as measured”.

Reads use `GET /project/{id}/env-file`, whose writes were observed immediately; project search
trails by up to about 1.6 seconds. Only `MATE_HQ_BIRTH_*` entries leave the API adapter. The first
record is embedded as `project.envVariables` in the single import: there is no project on which to
write before that request. A bounded read waits if the project appears before its initial env.

- `MATE_HQ_BIRTH_RECORD_<n>` is a versioned, validated snapshot: step, birth tag, project id,
  service ids, creation/import processes, working/anchor token ids, app version, upload completion,
  the uploaded version's YAML, deploy process, routing and routing-sync process, attempt and stop.
- `MATE_HQ_BIRTH_ACTION_<action>_<attempt>` reserves an action before its write, with its input
  handles. Its immutable `_result` records returned handles before another step can run.
  `_refusal` records a definite platform rejection. Receipts survive a missing later snapshot.
- Secrets are absent from snapshots, intents and receipts. Token values and HQ's sealing key go
  only into sensitive service variables. A lost one-time token value is followed through its token
  id and a separately journaled regeneration, rather than minting another token.

Every journal POST is itself followed through the returned process before the next operation.
Read polling has deadlines. Writes are not automatically retried, including `userDataSyncRunning`.
A deploy or routing-sync process already recorded is followed even if a listing appears settled.
A failed deploy retains its app version and old process receipt; **Again** builds that version
under a new attempt after the process has definitely failed.

## Claim and interruption

`MATE_HQ_BIRTH_CLAIM_<n>` contains a random owner and an expiry. The next numbered key is reserved
with POST; a uniqueness refusal means another browser won. A browser with a live claim renews it
with a new slot at half of the 90-second lease. Other browsers read its progress and wait. Completion
or a recorded stop appends a released claim. If the tab closes or suspends, the claim expires and
another admin automatically claims the next slot. Claim waiting is bounded at 15 minutes.

A lease alone cannot fence a request already in flight, and clocks can differ. The unique action
intent is the additional fence: an old holder and its successor cannot issue the same action.
An old holder may publish a receipt for a request it already sent after losing ownership; it cannot
advance the journal or start another action. A successor waits up to two minutes for such a receipt.

If the browser dies after dispatch but before receiving/publishing a handle, the platform supplies
no atomic transaction between the external operation and its receipt. The runner follows saved
handles and existing named tokens/routings where possible; an unanswered action with no receipt
stops as uncertain. **Again** checks that same action, never discards its identity or replays it.
The reason directs an admin to inspect it in Zerops. Definite credit and permission refusals tell
the person to add credit or restore access before **Again**.

There is also no org-wide create-once env slot before any project exists. The project claim protects
a discovered birth; it is not an org-wide transaction around the first import. Multiple nascent HQ
projects are an ambiguity and stop. An old tagged project with no journal is not adopted by name
or tagged existence alone. No unmeasured tag CAS or token-name uniqueness is assumed.

## Surfaces and proof

The shared runner and API apply to web and desktop's web bundle. Mobile has no HQ-birth gate yet;
this change introduces no separate mobile onboarding or setup control. No RPC/provider contract
changes are needed. The gate's account store holds presentation only and drops it on account close.

Focused tests exercise cross-browser continuation, intent/receipt persistence, expired-claim
handover with a late response and only one build, uncertain uploads, recorded refusals, process
failures, direct env reads and manual Again. This is fixture proof; no live platform or browser run
was requested for this change.
