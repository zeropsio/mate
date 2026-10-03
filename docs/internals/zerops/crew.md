# Crew mode — the map

2026-09-28, as built at `feat/crew-mode`; the Crew tab, the run's clock and the crew's words as
built on `fix/pass-20`, 2026-09-30. What crew mode is in code and where each part lives. It holds
facts about the tree, not decisions: `../../../../zcp/docs/spec-mate.md` has no crew section yet, so
until it has one each rule is stated in the header of the module named beside it. Words the UI uses
are the glossary's ([`design-system.md`](design-system.md) §2).

## 1. What a crew is

Three levels, each built on the one before:

- **Mate** — one agent over one Zerops project's tree (`/var/www` on the zcp container); unchanged
  by crew mode
- **chats** — the Mate's several conversations over that same tree — person threads; the main chat
  is the pinned one; no new one is started, and a Mate holding more than one lists them from the ⌄
  after its name on the conversation's line (`apps/web/src/components/chat/ConversationStrip.tsx`)
- **crew** — standing crewmates, one crew per Mate (id always `main`); each crewmate talks in its
  own chat, and a writer works in its own copy of the code on a dev service; the person puts each
  piece of work into the Mate's tree by a press (the engine's `land`)

A crewmate is one of three kinds (`packages/shared/src/crewHome.ts`), which the Crew tab says by
what each does — _Builds_, _Reviews_, _Plans_:

- **writer** — its copy of the code is branch `crew/<handle>` checked out at `.crew/<handle>` in
  its dev service's tree (`CrewDefinition.ts`, `CrewWorkspace.ts`), with its own `setup`, `check`
  and `run` commands and a crew port for its app (`CrewChecks.ts`, `CrewApp.ts`, `crewPorts.ts`);
- **reader** — read only, no service; it may review;
- **lead** — read only, at most one per crew; it plans, reviews, takes the crew's questions first
  and ends a run, and has no copy and no tasks of its own (`crewLead.ts`).

Work is **tasks**. A crewmate works one task at a time and queues the rest; a message to a crewmate
with no open task opens an implicit one (`crewTasks.ts`). A reported task merges your tree's head
into the copy and runs the check on exactly the tree that would land (`crewLanding.ts`,
`CrewIntegration.ts`); what happens next is the run's landing mode (§7), and without a run nothing
lands without the person's _Add to Fen's code_ or _Add what it has_ in the task's review (`land`,
`landNow`). Every crew turn is admitted as a person: the caller's session inside their own call;
later on their behalf, `{kind: "crew", startedBy}` — the running run's starter, or without a run the
task's creator (`CrewDispatch.ts`).

A crewmate's conversation is a **stint**: one Mate thread over one session. Apply opens each
crewmate's first stint without a turn, so its chat exists before its first message, and opens it
once — a first message or a lead wake at the same moment gets the same conversation — a writer's
once its copy is ready, since a writer's conversation runs in its copy (the lane's directory
through the mount); a reader's and the lead's run in the Mate's tree (`crewApply.ts`,
`CrewStints.ts`). The crewmate, its copy, its tasks and its memory carry across stints; a
rotation retires the current stint (archive, then session stop) and opens the next, whose first
line is the seam that says why (`CrewStints.ts`, `rotationDecision.ts`).

## 2. The switch

`T3CODE_ZEROPS_CREW` — `Config.Boolean`, default `true` (`apps/server/src/cli/config.ts`,
`ServerConfig.zeropsCrew`). `crewLayer.ts` applies three gates in order: outside a Zerops project,
or with the switch off, it builds the inert engine (the feed says `off` once, every request is
`unavailable`, no thread is a crewmate's, every crew tool answers that it is not available).
Otherwise the live engine runs, and with no crew applied it opens no ssh session and installs
nothing into the thread policy registries, so every thread's adapter options stay byte-identical.
An applied crew, at boot or by Apply, installs the crew's thread policies for the engine's life. A refused dispatch waits for an explicit Try again.

## 3. Where the code lives

| Layer          | Path                                                                                                                                       | Holds                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire           | `packages/contracts/src/zeropsCrew.ts`, `zeropsCrewStates.ts`                                                                              | the RPC shapes (`CrewSnapshot`, `CrewCommand`, `CrewFiles`, `CrewSeam`); the closed unions every crew slice shares                                    |
| Shared         | `packages/shared/src/crewHome.ts`, `crewTemplates.ts`; `userAsk.ts`                                                                        | the crew home's format, parser and validation; the three starting crews; `CREW_CARD_OPENER`, which marks a server-written task card                   |
| Server engine  | `apps/server/src/zerops/crew/` — `crewLayer.ts`, `CrewEngine.ts`, `crewCore.ts`                                                            | the layer and its gates, the command switch, the snapshot hub; the engine service and its inert form; the state every engine part shares              |
|                | `crewApply.ts`, `crewTasks.ts`, `crewTurns.ts`, `crewLanding.ts`, `crewClaims.ts`, `crewBoot.ts`                                           | Apply and saves; messages, tasks and queues; provider events at turn end; merge-in, check and landing; Show on dev; restart interruption records      |
|                | `crewRuns.ts`, `crewRunFlow.ts`, `crewLead.ts`, `crewMemoryCommands.ts`                                                                    | runs and their meters; what a running run does by itself; the lead's plans, reviews, questions and finish; the person's presses on memory             |
|                | `CrewDispatch.ts`, `CrewStints.ts`, `crewCards.ts`, `crewSeamLines.ts`, `crewSnapshot.ts`, `crewDirectory.ts`                              | the one crew turn builder; stints and rotation; the cards the engine writes into a chat; seam lines; one feed frame; the engine's side of the seam    |
| Pure core      | `crewMachines.ts`, `crewRouting.ts`, `crewPrompt.ts`, `crewVersions.ts`, `rotationDecision.ts`, `CrewPolicy.ts`, `CrewPacket.ts`           | task, run, stint and claim machines; where a message goes; the system prompt; versions and pending; when a stint rotates; the gate; packet and delta  |
| Git over ssh   | `CrewShell.ts`, `CrewWorkspace.ts`, `CrewIntegration.ts`, `CrewStateRef.ts`, `crewState.ts`, `CrewChecks.ts`, `CrewApp.ts`, `CrewReads.ts` | the only way crew code reaches a dev service; lanes; merge-in, landing and ref policing; the state ref and what it mirrors; setup and check; the app  |
| Store          | `CrewStore.ts`, `CrewHome.ts`                                                                                                              | the crew tables plus a change feed; the crew home's files                                                                                             |
| Policy, tools  | `crewSeams.ts`, `CrewThreadPolicy.ts`, `CrewTools.ts`, `CrewRuntime.ts`, `CrewMemory.ts`                                                   | `CrewThreadDirectory` and `CrewToolHost`; the SPI answer for crew threads; the in-process crew tools; the Show-on-dev claim; memory, packet and delta |
| RPC            | `registerCrewRpc.ts`                                                                                                                       | the four crew RPCs, spread by `ws.ts`                                                                                                                 |
| Client runtime | `packages/client-runtime/src/zerops/crew/phrases.ts`, `crew/testing/fixtures.ts`, `projections/crew.ts`                                    | every crew word (R5); `crewSnapshotFixture`; `deriveCrewView` — the snapshot joined to the thread shells                                              |
| Web            | `apps/web/src/zerops/crew/`                                                                                                                | `useCrew`, `useCrewCommand`, `crewCommands`, `useCrewHome`, `crewHome` (the editors' adapter over the format), `crewTab`                              |
|                | `apps/web/src/components/zerops/crew/`                                                                                                     | the Crew tab's column and views, its run dialog, the lead's plan and the crewmate chat — rows `zerops-crew-*` in [`surfaces.json`](surfaces.json)     |

## 4. The crew home and what the engine keeps

- **The crew home** — `<ServerConfig.cwd>/.mate/crew/main/` on the zcp container: `crew.yaml` (the
  crew and its members), `brief.md` (at most 16,000 characters), `jobs/<handle>.md`
  (`CrewHome.ts`; the format in `crewHome.ts`'s header). A write that would leave a home which
  does not parse is refused with nothing written. Nothing applies until Apply, `briefSave` or
  `jobSave`.
- **Tables** — migration `055_Crew`: `crew_definition`, `crew_member`, `crew_lane`, `crew_run`,
  `crew_assignment` (tasks), `crew_attempt`, `crew_stint`, `crew_memory`, `crew_claim`, `crew_log`,
  `crew_host`. Migration `054_ProjectionThreadsCrew` adds `projection_threads.crew_json`, a
  thread's crew origin.
- **On each dev service** — lanes under `.crew/<handle>` (`.crew/` in the repository's
  `info/exclude`; a lane's `.git` names its gitdir relatively, so its git also works through the
  mount), an app's `.crew/<handle>.run.log` and `.run.pid`, attempt refs
  `refs/t3/crew/<run>/<task>/<attempt>` (`manual` for `<run>` without a run) and landing anchors
  `refs/t3/crew/landing/<task>`. A landing is one squash commit with `Crew-Lane:` and
  `Crew-Assignment:` trailers; crew commits are authored as `Zerops Mate Crew <crew@zerops.io>`.
- **The crew-state ref** — `refs/t3/crew-state/main` on the home service mirrors the crew home,
  each crewmate's memory (`memory/<handle>/…`) and the board (`board.json`), with the crew's `seq`,
  so a Mate that lost its database finds the crew in git; it is flushed at Apply, after a save and
  at every turn's end (`crewState.ts`, `CrewStateRef.ts`).
- **Versions** — the brief's vN and each job's vM live in the tables, not the files; a stint records
  the versions its session started with, and a crewmate is pending while that record is behind
  (`crewVersions.ts`). No version reaches the person: a save says once what follows, and a new
  conversation's seam line says what changed.

## 5. The RPCs

| Method                  | Kind   | Scope   | Carries                                                                 |
| ----------------------- | ------ | ------- | ----------------------------------------------------------------------- |
| `subscribeZeropsCrew`   | stream | read    | one whole `CrewSnapshot` per change                                     |
| `zerops.crew.files.get` | unary  | read    | the crew home's files                                                   |
| `zerops.crew.files.put` | unary  | operate | files to write into the crew home                                       |
| `zerops.crew.command`   | unary  | operate | one `CrewCommand` (discriminator `_tag`) → `CrewCommandResult` or error |

Registered by `registerCrewRpc.ts`, spread by `ws.ts`; scopes in
`apps/server/src/auth/RpcAuthorization.ts`. A command runs as the connecting session — its subject
comes from the authenticated session, never from the input — and a command that runs or changes
the crew, or a write to the crew home, is refused at its door as `not-allowed`, in admission's
words, for a person who may not run a login it reaches (`crewAccess.ts`, §6 _Admission_). The snapshot is built from the tables
and the engine's memory, never over ssh, at most four times a second, with `seq` rising across
restarts (`crewLayer.ts`, `crewSnapshot.ts`). An older server's snapshot still decodes, and a frame
no build can read decodes as undecodable and fails the crew feed alone, never the socket
(`zeropsCrew.ts`). Words are not on the wire, but for the engine's own sentences — an attempt's
ending, a stint's reason, a seam's summary, a refusal's detail — which it writes in the person's
words; clients render every code through `phrases.ts`. A task carries `landedAt`, the time it went
in (`null` before, and from an older server by a decoding default; an older client ignores it), and
a run's `elapsedMs` is the time its crew worked (§7).

## 6. Seams into existing code

Server:

- **Boundary** — only `ws.ts`, `zeropsFeedsLayer.ts` (composes `crewLayer`) and
  `ZeropsFixtureFeeds.ts` (the inert form) import from `zerops/crew/`, and crew code imports only
  the services the zone test names, never `provider/**` (`scripts/mate-zone-architecture.test.ts`,
  "crew boundary").
- **Admission** — `ZeropsTurnAdmission.ts`: `TurnPrincipal` is `session` or `crew`; a person never
  archives, restores or deletes a crew thread, no turn starts on a retired stint, and none starts
  on a crew thread without a thread tool profile. `CrewDispatch.ts` is the crew's only turn builder
  (`scripts/turn-start-sites.test.ts`). A login beyond the two defaults is gated on its own signer
  (`ZeropsLogins.ts`); a queued task whose admission was refused starts again once a sign-in or a
  signer changes (`crewRunFlow.ts`).
- **The crew's door** — `crewAccess.ts` judges every press before it runs, as the person, on the
  logins it reaches (`crewCommandReach` and `crewReachLogins` in `zeropsCrew.ts`, the same answer a
  client reads off its snapshot): a crewmate's own for its message, answer, new task, conversation,
  memory, app, Show on dev, removal or an adopted branch; the crewmate's and the one the crew home
  now names for `jobSave`; each task's crewmate's for the task presses and the plan; the claiming
  crewmate's for a claim; the lead's, or each mentioned crewmate's without one, for `tell`; every
  crewmate's for a run's start, resume or finish and the goal; every crewmate's and every login the
  crew home names for Apply; none for `stop` and `pause`, which any member may press — a colleague
  stops what they may not start, and the turns they interrupt ask admission nothing, as any turn's
  interrupt passes it; none for `deliverDraft`, `orphanScan` and `addCrewPorts`, which only read. A
  write to the crew home reaches the crewmates it changes, before and after, and every crewmate's
  when it changes the goal or the crew's name. `ZeropsTurnAdmission.admitOperator` judges each login
  by whose it is, as a turn on it once signed in: held here by somebody else, or by nobody on
  record, refuses; one no credential holds, a project token's and a driver Mate signs nobody in to
  pass.
- **Crew origin on threads** — `ThreadCrewOrigin {crew, crewmate, stint}` on the thread, its shell
  and `ThreadCreatedPayload`, set once by the internal command `thread.crew.create`
  (`packages/contracts/src/orchestration.ts`, decider, projector, `ProjectionPipeline.ts`,
  `ProjectionSnapshotQuery.ts`). `ProviderCommandReactor.ts` and `CheckpointReactor.ts` keep no
  checkpoints for a crew thread; `AgentAwarenessRelay.ts` publishes no alert for one.
- **Seam lines as thread activities** — a landing, a save that reaches a conversation later, and the
  reason of a conversation opened between turns are thread activities of kind `crew.seam` on the
  conversation the person reads at that moment, a `CrewSeam` as payload and the line's words as
  `summary` (`crewSeamLines.ts`), in the person's words and never a version — "Its job changed",
  "The crew's goal changed — from its next message", "You cleared its conversation", "A fresh
  conversation: the last one grew too long" (`crewCards.ts`); the client composes a landing's line
  and a closed task's from the seam itself ("… went into Fen's code", "… closed with nothing to add
  to Fen's code"), and shows an older server's line as it was written. A seam line never fails the
  press that wrote it.
- **Provider SPI** — `spi/threadToolPolicy.ts`, `spi/claudeThreadProfile.ts`,
  `spi/codexThreadProfile.ts`, `spi/serverCommandReadiness.ts`; registries provided in `server.ts`,
  readiness completed in `serverRuntimeStartup.ts`. A Claude crew session's own start reaches the
  extension with the process's first prompt (a `UserPromptSubmit` hook) and its context rides on
  that prompt; compaction and `/clear` arrive through `SessionStart`, summaries through
  `PostCompact`, and a compaction whose `SessionStart` never comes is marked by `PreCompact` and
  handed over with the next prompt. The full contract and the no-crew byte-identity snapshots:
  [`spi.md`](spi.md) §1a.

Client:

- **Crew tab** — right-panel kind `crew` (`rightPanelKinds.ts`, `rightPanelStore.ts`,
  `RightPanelTabs.tsx`), `hidden` unless the Zerops panel is available and the status is `none` or
  `applied`, is the crew's one home (`CrewPanel.tsx`). For `none` it is the empty state — the Mate,
  three empty seats, "Give Fen a crew" and _Set up a crew_; for `applied`, one column
  (`CrewSection`): the head (`CrewHead`: the goal's title, the tab's ···, and the mode line with its
  one press, `crewModeLine`), the composer (`CrewTellComposer`), a row per crewmate (`CrewRows`:
  what it is on, its step, what it needs and the presses that settle it; the lead's row carries its
  plan, `CrewLeadPlan`) and _In Fen's code_ (`CrewInFensCode`). Setup, the goal and a crewmate's job
  are views in the column's place (`CrewView`: `CrewSetup`, `CrewGoal`, `CrewmateJob`), asked for
  from outside the tab through `crewTab.ts` (`openCrewView`); the run dialog (`CrewRunDialog`) is
  _Let it work on its own…_ and _Keep going…_. The host (`CrewSectionHost`) owns the commands,
  drafts, confirmations and dialogs. The board and its sheets are gone. The Zerops tab has no crew
  section and no setup; its map still names crew ports by crewmate, and its coding agents' card who
  runs on each login.
- **Closed to a viewer** — a crew is exactly as closed as its conversations (D6): for a viewer who
  may not run the logins a press reaches, nothing that runs or changes the crew is offered, and
  everything that reads stays (`crewAccess.ts` in the client-runtime, the server's door's answer
  from the snapshot; `useCrewAccess.ts` reads each login as `ChatView` reads its own agent). In the
  composer's place the Crew tab says why and offers the conversation's one way out, _Sign in with
  your own account_, on a quiet 48 px pill — the composer's own height (`CrewTellLocked`); the empty
  state says it in place of _Set up a crew_. The head's goal only reads, with no ··· and, of the
  mode line's presses, only _Stop_ on a running crew; a row offers no press that reaches such a
  login and no ··· that would offer nothing; the plan reads without its presses; _Try its work_ only
  opens what already runs; a view that changes the crew does not open. The crewmate's menu on the
  conversation's line says why under its job, a crew task's review drops _Add to Fen's code_ and its
  ask, and the left menu drops _Set up a crew_. `design-crew.html?viewer=other` draws every state
  so.
- **Chat** — `ChatHeader.tsx` and `ConversationStrip.tsx`: the conversation's line — the Mate, then
  the crew's faces, the crewmate on screen a pill whose menu (`CrewmateMenu`) offers _Try its work_
  (`useCrewTry`, `crewTry.ts`: its own app, run first while stopped, or its work shown at the Mate's
  dev address), _Stop its app_, _Change its job_ (the lead's _Change the goal_), each opening that
  view in the Crew tab (`openCrewView`), and _Clear its conversation_; `ChatView.tsx`: the lead's
  plan in the lead's chat as in its row (`CrewLeadPlan`), and a crew thread's send as
  `zerops.crew.command` `message` instead of a turn start; `MessagesTimeline.tsx` and
  `conversation.logic.ts`: a message opening with `CREW_CARD_OPENER` drawn as a task card,
  `crew.seam` activities drawn as seam lines — a save's from before the first message left out
  (`crewChatSeams.ts`) — and an empty crewmate conversation opening with the crewmate
  (`CrewmateEmptyState`); `TurnReport.tsx`: _Try it_ beside _Review_ on a crew task's finished work
  (`CrewTryIt`). In a crew thread the speaker — the work line, the answer's heading, the working
  face — is the crewmate, in its name and tint, never the Mate.
- **The lead** reads as the lead: first in the crew on the line and in the Crew tab, named the
  Mate's lead on hover, its line saying what it does, with no chip, and the coding-agents card names
  it on the login it runs on.
- **Composer** — trigger kind `crewmate` (`composer-logic.ts`, `ComposerCommandMenu.tsx`,
  `composer-editor-mentions.ts`), offered in the lead's chat and in no other; the Crew tab's
  composer ("Give the crew something to do…") sends to the lead, or without one to the faces picked,
  and its `@` finds the Mate's files — nobody is named by a handle. In a crewmate's chat the model,
  effort and permission pickers give way to one read-only _Runs on_ line ("Runs on Claude Code ·
  Haiku 4.5 · High") that opens the crewmate's job in the Crew tab (`CrewRunsOnControl`,
  `ChatComposer.tsx`): its Runs on and the crew gate decide those, not the message.
- **Sidebar** — `SidebarZeropsTree.tsx`: the crew's faces on the Mate row, and in a Mate's own menu
  (`SidebarMateMenu.tsx`) _Set up a crew_ or _Crew_ on the viewer's own Mate with crew mode on
  (`mateCrewItem`), opening its conversation on the Crew tab (`openCrewTab`), _Set up a crew_ on its
  setup view. A crew thread is never an ordinary row: `Sidebar.tsx`, the command palette, the
  archived list, thread notifications, mobile's thread list and prompt-history recall all leave crew
  threads or cards out.

## 7. What this build does

**Without a run** (manual work): Apply with per-crewmate progress; writers' copies with setup,
check and a crew port each (`addCrewPorts` proposes the ports the Mate's message declares; the
engine never deploys); the crewmate's app (`appRun`, `appStop`); person-started turns —
`message`, `tell`, `taskCreate`, `taskEdit`, `discard`, `markFresh`, `taskRetry`; the WIP commit
at every turn end; merge-in, check, `land` and `landNow` with landing refusals classified
(`classifyLandingRefusal.ts`); `startFresh`; `briefSave` and `jobSave` with rotation;
`removeCrewmate`; `deliverDraft`, `orphanScan`, `adopt`; explicit continuation after a Mate server restart.
Every crew turn traces to a person's press.

**Show on dev** (`crewClaims.ts`, `CrewRuntime.ts`): the crewmate asks with `crew_show_on_dev` (the
request times out after 10 minutes); the person answers with `claimGrant`, `claimDeny` or later
`claimRelease`, or presses `showOnDev` — _Try its work_ for a writer whose app cannot run on its own
— as request and grant at once. A grant pressed while the crewmate's turn runs waits for that turn's
end, then sends the claim turn as the person who pressed it, and keeps the request from timing out;
a deny or any other move of the claim drops it. The waiting grant is `grantWaiting` on the wire —
the crewmate's row reads "Shows its work at Fen's dev address once its current step ends." — and the retained request after a restart. Show on dev restarts the dev server zcp
started; with none, the refusal says to ask the Mate to start it, or to open the crewmate's own app
when it has a crew port.

**Runs** (`crewRuns.ts`, `crewRunFlow.ts`): `start` takes a budget, a time limit (either may be _No
limit_), an optional stop at a share of the usage window, a landing mode (`person` — you land
everything; `check` — a task lands when its check passes; `lead` — after the lead's review), the dev
grant and whether the lead may start tasks. `pause`, `resume`, `stop` and `finish` move it; pausing
or stopping interrupts every crew turn, each ending with its WIP commit. The Crew tab presses
`start` as _Let it work on its own…_, `stop` as its one _Stop_, and `resume` as _Keep going…_ after
a limit — with more money or more time, added to what the run spent or worked, never a new figure —
or as _Try again_ after a refusal; `pause` is no press of the person's. A plan's _Start_ takes the
plan into a running run, starts a run on the last run's limits where none is on, and resumes a
paused run first. A reached limit pauses the run with that limit as its reason; a refused dispatch
pauses it with admission's words. `resume` may carry new limits (budget, time, usage stop; an absent
one keeps the run's), which a run paused by its budget or time limit resumes with through the run
dialog; a budget must exceed what the run has spent, and a limit still reached refuses the resume by
name ("The run has spent its $3 budget — raise it or choose No limit to resume"). Spend is each crew
turn's own cost: what its session's `totalCostUsd` — a running total, carried over a resume — rose
by since the last total the engine kept for that thread (a `turn-cost` note in `crew_log`). A live
session with no kept total (its turns ran before totals were logged), or one whose total comes back
below the kept one, counts nothing for that turn and counts from its new total on. Time is the time
the crew works: the run's clock counts while the run runs and one of the crew's turns runs, and
stands, keeping what it counted, while none does (`runClockFollows`, followed wherever a crew turn
begins or ends), so a crew idle, waiting on the person or with nothing to do never uses up its time
limit, and a restart counts again once the crew works. `elapsedMs` keeps its name and now means that
time: an older server counts wall time running, and a client reads either the same way. Usage is the
fullest window of the crewmates' logins. A crew session's `maxBudgetUsd` is what the run has left —
the CLI caps a process's own spend (§8) — and a run's start or resume restarts the crew's sessions
so each takes the new cap: an idle one at once, a working one when its turn ends. While running, the
run starts queued tasks, sends rework back, lands per its mode, nudges a turn that ended without a
report once per attempt, and with the dev grant allows a request to show on dev. A run's start or
resume take up what waits on someone (`takeUpWaiting` in
`crewRunFlow.ts`): every crewmate whose task stands `working` with no turn running gets a carry-on
turn as the run's starter (a turn the run's own pause stopped carries on in the pause's words), and
every review, and every question not passed on to the person, that the lead was woken for and no
running turn of the lead's serves wakes the lead again (`wakesToRenew` in `crewLead.ts`).

**What waits on someone** (`crewRunFlow.ts`, `crewLead.ts`, `crewSnapshot.ts`): a task that stands
still is either taken up by a running run or named to the person in its crewmate's row. A crewmate's
queue waits behind its open task until that task lands, parks or is discarded, so a task nobody acts
on holds every task after it.

| A task stands                               | A running run                                                                                   | In its crewmate's row                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `working`, no turn running                  | carries it on at start and resume; nudges it once an attempt after a turn ends without a report | `stalled` once nobody has acted for five minutes, in a run too         |
| `review`, no turn of the lead's on it       | wakes the lead again at start and resume                                                        | `review-wait` once nobody has acted for five minutes, in a run too     |
| `ready`                                     | lands it when its landing is _check_, or _lead_ after the lead's accept                         | `ready-to-land`, always                                                |
| `blocked` on a question                     | wakes the lead first, again at start and resume                                                 | `question` at once without a run; in one after 15 minutes or passed on |
| `rework` after a review's reject            | sends it back to its crewmate at once                                                           | `sent-back` when no run is running                                     |
| `queued` behind a discarded or stopped task | nothing starts it                                                                               | `dependency-gone`                                                      |

A turn that leaves its task `working` ends the task's attempt — `crew_attempt.ending` is `budget`,
`run-paused`, `run-stopped`, `interrupted`, `failed` or `no-report`, with its words in
`ending_detail` and `ended_at` — and the attempt's next turn opens it again; a rework's new
attempt has a row of its own. At boot an attempt a turn left open without the engine seeing it end
ends interrupted at restart, with its dirty files untouched and its last confirmed operation stage visible immediately. The five minutes are one rule (`UNATTENDED_MS`): a `stalled` row
counts from the attempt's end, a `review-wait` row from the task's move into review, and the feed
publishes again when they pass.

An attempt the crew's stop ended says when, in the person's words and with the limit's own figure
(`attemptEndingOf` in `crewMachines.ts`, fed the run's limits by `crewTurns.ts`): "when the $20 ran
out", "when the 8 hours ran out", "when it neared 80 % of your Claude plan's limit", "when you
stopped it", "when its next turn was refused". The Crew tab joins such a clause without a colon —
"Stopped mid-way when the $20 ran out." — and any other reason after one. Both pair with older
builds: an older client shows "Backend's task #12 stopped mid-way: when the $20 ran out", and a
newer client shows an older server's "Stopped mid-way: the run reached its budget." as it was
written.

**The lead** (`crewLead.ts`): the person talks to it like any crewmate, and the Crew tab's composer
goes to its chat (`crewRouting.ts`). In a running run the engine wakes it, one wake at a time, at
least two minutes apart (across a restart too; the person's `start` or `resume` wakes it at once) and at
most 30 per run: for a review (`crew_review` accepts, or rejects with the note as rework) and for a
crewmate's question (`crew_report` blocked goes to the lead first; its reply is the crewmate's next
turn; a question only the person can answer reaches them at once, and any question reaches them
after 15 minutes). `crew_propose` puts tasks on the board as `proposed` — `queued` when the run lets
the lead start them — for the person's _Start_ (`planAccept`) or _Drop the plan_ (`planDiscard`), in
the lead's row and its chat; `crew_finish` ends the run. The lead's tasks start only in a running
run.

**Memory** (`CrewMemory.ts`, `CrewPacket.ts`, `crewMemoryCommands.ts`): a Claude crewmate's prompt
turns memory on and it gets `crew_memory`; its session starts with the state packet on startup,
compaction and `/clear`, and with the resume delta on resume (`crewDirectory.ts`,
`sessionStart`). A stint rotates at the crewmate's next task after `rotateAfter` compactions
(default 3, 0 = never; `crewTurns.ts`, `rotationDecision.ts`). The person edits or removes one
entry (`memoryEdit`, `memoryRemove`) or forgets all of them (`forgetMemory`), which never touches
the copy or the tasks.

**Tools by kind** (`CrewTools.ts`): a writer gets `crew_report`, `crew_board`, `crew_diff`,
`crew_show_on_dev`; a reader `crew_report`, `crew_board`, `crew_diff`, `crew_review`; the lead
`crew_report`, `crew_board`, `crew_diff`, `crew_propose`, `crew_review`, `crew_finish`; plus
`crew_memory` wherever memory is on.

**Logins and Codex:** logins beyond the two defaults each have their own home under
`~/.mate/logins/<id>` and their own signer (`ZeropsLogins.ts`). A Codex crewmate is code only: no
zcp tools, no crew tools and no memory, so its task completes by the person's _Add to Fen's code_.
Codex wraps a command as `<shell> -lc "<command>"`; for zsh, bash or sh with `-lc` or `-c` the gate
judges the command inside, and only the exact lane form passes (`codexThreadProfile.ts`, `spi.md`
§1a).

**Refusals:** a refused command reads as the engine's own sentence, never the tagged error, beside
the row that was pressed and only until the next press or ten seconds; the tab's last error is the
same sentence (`failureWords` in `crewCore.ts`, `crewFailureSentence` in `useCrewCommand.ts`); where
the engine says "your Mate" or "your tree", the tab says the Mate's name or "Fen's code"
(`crewNamingTheMate`).

**Client:** the mode line and its presses are the Crew tab's head (§6). A task that could not start
reads "Couldn't start: …" and offers _Try again_ (`taskRetry`); a stopped one, "Stopped: …", _Try
again_ and _Drop it_ (`discard`); one stopped mid-way, "Stopped mid-way when the $20 ran out.",
_Continue_ (a `message` "Carry on with your task." as you), _Review what it has_ (its review, whose
_Add what it has_ is `landNow`) and _Drop it_; a review nobody takes up, "Waits for the lead's
review.", _Ask the lead_ (a `message` to the lead as you) and _Review it yourself_ (its review,
where `land` on a task in review is your accept first); a task its review sent back, "The lead sent
it back: <note>", _Ask it to rework_ (a `message` to the crewmate as you, carrying the note) and
_Drop it_; a queued task behind one that will not go in, "Waits for <title>, which was dropped.",
_Start it anyway_ (`taskEdit` without that dependency, after which it starts when its crewmate is
free) and _Drop it_; a clash, "Clashes with what's now in Fen's code, in <file>.", _Ask it to sort
it out_ (`askResolve`); failing checks, _Ask it to fix them_ (`askFix`); the Mate's own uncommitted
edits in the way, "Can't go into Fen's code yet: Fen has uncommitted edits to <file>.", _Ask Fen to
commit them_.

## 8. Measured facts the design stands on

Measured 2026-09-27 against Claude Code 2.1.283; the measurements are the ledger's —
[`verified.md`](verified.md), "Crew mode's CLI and port facts".

- **A resumed session keeps the append it started with** (probe 22 failed). So a changed brief or
  job reaches a crewmate only in a new stint: `nextTurn` rotates at its next turn, `fresh` at once
  between turns, `now` interrupts a running turn, commits its work, rotates and sends one continue
  turn as the person; a new login is always `fresh`. Model and effort reach the next turn without
  a rotation, since the profile reads them at every turn (`rotationDecision.ts`, `crewApply.ts`,
  `CrewStints.ts`).
- **`dontAsk` runs a tool a `PreToolUse` hook allows**; without the hook the call is denied. A crew
  session runs in `dontAsk` with `CrewPolicy` as a total `PreToolUse` hook, so what the gate does
  not allow is denied (`CrewPolicy.ts`, `spi.md`).
- **An SDK `SessionStart` callback never runs for a process's own startup or resume**, while
  `UserPromptSubmit` does and its context reaches the model. So a crew session's start is handed
  over with its first prompt (§6, _Provider SPI_).
- **A turn's `total_cost_usd` is its session's running total, carried over a resume, while
  `maxBudgetUsd` caps the process's own spend** (the rig's lead, 2026-09-28; a haiku session
  resumed with a $0.005 cap over a carried $0.0185 ran two responses and stopped once its own
  spend reached $0.0065). So a turn costs its total's rise, and a session's cap is the run's
  remainder (`crewRuns.ts`, `crewDirectory.ts`).

A conversation whose recorded path differs from its crew copy keeps that path across server
restarts. Its crew row shows “Conversation points elsewhere” with the current and crew paths.
“Use crew copy” changes only the selected current conversation, as its login's operator; a path
changed since the row was read refuses the action. New stints record their copy at creation.

## Explicit operation endings

`crew_operation` owns dispatch, checkpoint, merge/check, landing and selected copy rebuilds.
An identity, actor, exact thread command or copy/ref target, and pending stage are durable before
that stage runs. Its receipt confirms the stage afterward; the handle remains running until the
consumer has recorded the task outcome. A fatal restart marks running handles interrupted. Boot
reads copy status and known landing trailers, pauses a running run, and does not commit files,
recreate copies, delete landing anchors, merge, check, dispatch, or advance queues.

Interrupted rows offer Continue and, before landing, Drop it. Continue operates on the selected
handle under the crewmate's lock, rejects a changed attempt or newer handle, and records a new
operation for its side effects. An already landed receipt only records the task's outcome.
Drop it ends the task's records while leaving its dirty files and HEAD in place. Missing copies
offer Rebuild crew copy; that selected rebuild refuses a missing or changed saved branch and never
resets an existing directory. Infrastructure and context failures likewise wait for Continue.
Checks run once; a killed or timed-out command is a visible ending. A failed operation holds the
crewmate's queue until a person acts. Desktop uses these same web controls; mobile currently has
no crew controls and accepts the optional operation and assignment detail fields in the contract.
