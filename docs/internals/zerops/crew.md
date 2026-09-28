# Crew mode — the map

2026-09-28, as built at `da6a5f8f58` on `feat/crew-mode`. What crew mode is in code and where each
part lives. It holds facts about the tree, not decisions: `../../../../zcp/docs/spec-mate.md` has
no crew section yet, so until it has one each rule is stated in the header of the module named
beside it. Words the UI uses are the glossary's ([`design-system.md`](design-system.md) §2).

## 1. What a crew is

Three levels, each built on the one before:

| Level     | What it is                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mate**  | one agent over one Zerops project's tree (`/var/www` on the zcp container); unchanged by crew mode                                                                                                                           |
| **chats** | the Mate's several conversations over that same tree — person threads; the main chat is the pinned one, the others sit in the conversation strip (`apps/web/src/components/chat/ConversationStrip.tsx`)                      |
| **crew**  | standing crewmates, one crew per Mate (id always `main`); each crewmate talks in its own chat, and a writer works in its own copy of the code on a dev service; the person lands each piece of work into the tree by a press |

A crewmate is one of three kinds (`packages/shared/src/crewHome.ts`):

- **writer** — its copy of the code is branch `crew/<handle>` checked out at `.crew/<handle>` in
  its dev service's tree (`CrewDefinition.ts`, `CrewWorkspace.ts`), with its own `setup`, `check`
  and `run` commands and a crew port for its app (`CrewChecks.ts`, `CrewApp.ts`, `crewPorts.ts`);
- **reader** — read only, no service; it may review;
- **lead** — read only, at most one per crew; it plans, reviews, takes the crew's questions first
  and ends a run, and has no copy and no tasks of its own (`crewLead.ts`).

Work is **tasks**. A crewmate works one task at a time and queues the rest; a message to a
crewmate with no open task opens an implicit one (`crewTasks.ts`). A reported task merges your
tree's head into the copy and runs the check on exactly the tree that would land
(`crewLanding.ts`, `CrewIntegration.ts`); what happens next is the run's landing mode (§7), and
without a run nothing lands without the person's **Land** or **Land now**. Every crew turn is
admitted as a person: the caller's session inside their own call; later on their behalf,
`{kind: "crew", startedBy}` — the running run's starter, or without a run the task's creator
(`CrewDispatch.ts`).

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
An applied crew, at boot or by Apply, installs the crew's thread policies and a watch on sign-ins
for the engine's life.

## 3. Where the code lives

| Layer          | Path                                                                                                                                       | Holds                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire           | `packages/contracts/src/zeropsCrew.ts`, `zeropsCrewStates.ts`                                                                              | the RPC shapes (`CrewSnapshot`, `CrewCommand`, `CrewFiles`, `CrewSeam`); the closed unions every crew slice shares                                    |
| Shared         | `packages/shared/src/crewHome.ts`, `crewTemplates.ts`; `userAsk.ts`                                                                        | the crew home's format, parser and validation; the three starting crews; `CREW_CARD_OPENER`, which marks a server-written task card                   |
| Server engine  | `apps/server/src/zerops/crew/` — `crewLayer.ts`, `CrewEngine.ts`, `crewCore.ts`                                                            | the layer and its gates, the command switch, the snapshot hub; the engine service and its inert form; the state every engine part shares              |
|                | `crewApply.ts`, `crewTasks.ts`, `crewTurns.ts`, `crewLanding.ts`, `crewClaims.ts`, `crewBoot.ts`                                           | Apply and saves; messages, tasks and queues; provider events at turn end; merge-in, check and landing; Show on dev; restart recovery                  |
|                | `crewRuns.ts`, `crewRunFlow.ts`, `crewLead.ts`, `crewMemoryCommands.ts`                                                                    | runs and their meters; what a running run does by itself; the lead's plans, reviews, questions and finish; the person's presses on memory             |
|                | `CrewDispatch.ts`, `CrewStints.ts`, `crewCards.ts`, `crewSeamLines.ts`, `crewSnapshot.ts`, `crewDirectory.ts`                              | the one crew turn builder; stints and rotation; the cards the engine writes into a chat; seam lines; one feed frame; the engine's side of the seam    |
| Pure core      | `crewMachines.ts`, `crewRouting.ts`, `crewPrompt.ts`, `crewVersions.ts`, `rotationDecision.ts`, `CrewPolicy.ts`, `CrewPacket.ts`           | task, run, stint and claim machines; where a message goes; the system prompt; versions and pending; when a stint rotates; the gate; packet and delta  |
| Git over ssh   | `CrewShell.ts`, `CrewWorkspace.ts`, `CrewIntegration.ts`, `CrewStateRef.ts`, `crewState.ts`, `CrewChecks.ts`, `CrewApp.ts`, `CrewReads.ts` | the only way crew code reaches a dev service; lanes; merge-in, landing and ref policing; the state ref and what it mirrors; setup and check; the app  |
| Store          | `CrewStore.ts`, `CrewHome.ts`                                                                                                              | the crew tables plus a change feed; the crew home's files                                                                                             |
| Policy, tools  | `crewSeams.ts`, `CrewThreadPolicy.ts`, `CrewTools.ts`, `CrewRuntime.ts`, `CrewMemory.ts`                                                   | `CrewThreadDirectory` and `CrewToolHost`; the SPI answer for crew threads; the in-process crew tools; the Show-on-dev claim; memory, packet and delta |
| RPC            | `registerCrewRpc.ts`                                                                                                                       | the four crew RPCs, spread by `ws.ts`                                                                                                                 |
| Client runtime | `packages/client-runtime/src/zerops/crew/phrases.ts`, `crew/testing/fixtures.ts`, `projections/crew.ts`                                    | every crew word (R5); `crewSnapshotFixture`; `deriveCrewView` — the snapshot joined to the thread shells                                              |
| Web            | `apps/web/src/zerops/crew/`                                                                                                                | `useCrew`, `useCrewCommand`, `crewCommands`, `useCrewHome`, `crewHome` (the editors' adapter over the format)                                         |
|                | `apps/web/src/components/zerops/crew/`                                                                                                     | the section, the editors, the board and the crewmate chat — rows `zerops-crew-*` in [`surfaces.json`](surfaces.json)                                  |

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
  (`crewVersions.ts`).

## 5. The RPCs

| Method                  | Kind   | Scope   | Carries                                                                 |
| ----------------------- | ------ | ------- | ----------------------------------------------------------------------- |
| `subscribeZeropsCrew`   | stream | read    | one whole `CrewSnapshot` per change                                     |
| `zerops.crew.files.get` | unary  | read    | the crew home's files                                                   |
| `zerops.crew.files.put` | unary  | operate | files to write into the crew home                                       |
| `zerops.crew.command`   | unary  | operate | one `CrewCommand` (discriminator `_tag`) → `CrewCommandResult` or error |

Registered by `registerCrewRpc.ts`, spread by `ws.ts`; scopes in
`apps/server/src/auth/RpcAuthorization.ts`. A command runs as the connecting session — its subject
comes from the authenticated session, never from the input. The snapshot is built from the tables
and the engine's memory, never over ssh, at most four times a second, with `seq` rising across
restarts (`crewLayer.ts`, `crewSnapshot.ts`). An older server's snapshot still decodes, and a frame
no build can read decodes as undecodable and fails the crew feed alone, never the socket
(`zeropsCrew.ts`). Words are not on the wire: clients render codes through `phrases.ts`.

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
- **Crew origin on threads** — `ThreadCrewOrigin {crew, crewmate, stint}` on the thread, its shell
  and `ThreadCreatedPayload`, set once by the internal command `thread.crew.create`
  (`packages/contracts/src/orchestration.ts`, decider, projector, `ProjectionPipeline.ts`,
  `ProjectionSnapshotQuery.ts`). `ProviderCommandReactor.ts` and `CheckpointReactor.ts` keep no
  checkpoints for a crew thread; `AgentAwarenessRelay.ts` publishes no alert for one.
- **Seam lines as thread activities** — a landing, a save that reaches a conversation later, and
  the reason of a conversation opened between turns are thread activities of kind `crew.seam` on
  the conversation the person reads at that moment, a `CrewSeam` as payload and the line's words
  as `summary` (`crewSeamLines.ts`). A seam line never fails the press that wrote it.
- **Provider SPI** — `spi/threadToolPolicy.ts`, `spi/claudeThreadProfile.ts`,
  `spi/codexThreadProfile.ts`, `spi/serverCommandReadiness.ts`; registries provided in `server.ts`,
  readiness completed in `serverRuntimeStartup.ts`. A Claude crew session's own start reaches the
  extension with the process's first prompt (a `UserPromptSubmit` hook) and its context rides on
  that prompt; compaction and `/clear` arrive through `SessionStart`, summaries through
  `PostCompact`, and a compaction whose `SessionStart` never comes is marked by `PreCompact` and
  handed over with the next prompt. The full contract and the no-crew byte-identity snapshots:
  [`spi.md`](spi.md) §1a.

Client:

- **Zerops tab** — `ZeropsPanel.tsx` mounts `CrewSectionHost` after the coding agents' card; the
  section exists only while the feed's status is `none` or `applied`.
- **Right panel** — kind `crew` (`rightPanelKinds.ts`, `rightPanelStore.ts`, `RightPanelTabs.tsx`),
  `hidden` unless the Zerops panel is available and the status is `none` or `applied`.
- **Chat** — `ChatView.tsx`: in the lifecycle strip's slot a writer's lane bar or the lead's bar
  ("Plans and reviews · no copy of the code", `CrewLeadBar`), the board in the right panel, the
  lead's plan in the lead's chat (`CrewLeadPlan`), and a crew thread's send as
  `zerops.crew.command` `message` instead of a turn start; `ChatHeader.tsx`: `CrewmateHeader`;
  `MessagesTimeline.tsx` and `conversation.logic.ts`: a message opening with `CREW_CARD_OPENER`
  drawn as a task card, `crew.seam` activities drawn as seam lines, and an empty crewmate
  conversation opening with the crewmate (`CrewmateEmptyState`); `ConversationStrip.tsx`: the crew
  group. In a crew thread the speaker — the work line, the answer's heading, the working face — is
  the crewmate, in its name and tint, never the Mate.
- **The lead** reads as the lead: the compass mark on its strip chip (the icon map's `crew-lead`),
  a Lead chip beside its name in its header and the section, its own group first in the section,
  and the coding-agents card names it on the login it runs on.
- **Composer** — trigger kind `crewmate` (`composer-logic.ts`, `ComposerCommandMenu.tsx`,
  `composer-editor-mentions.ts`), offered in _Tell the crew_ and in the lead's chat, in no other
  chat. In a crewmate's chat the model, effort and permission pickers give way to one read-only
  _Runs on_ line ("Runs on Claude Code · Haiku 4.5 · High") that opens the crewmate's editor
  (`CrewRunsOnControl`, `ChatComposer.tsx`): its Runs on and the crew gate decide those, not the
  message.
- **Sidebar** — `SidebarZeropsTree.tsx`: the crew's faces on the Mate row. A crew thread is never
  an ordinary row: `Sidebar.tsx`, the command palette, the archived list, thread notifications,
  mobile's thread list and prompt-history recall all leave crew threads or cards out.

## 7. What this build does

**Without a run** (manual work): Apply with per-crewmate progress; writers' copies with setup,
check and a crew port each (`addCrewPorts` proposes the ports the Mate's message declares; the
engine never deploys); the crewmate's app (`appRun`, `appStop`); person-started turns —
`message`, `tell`, `taskCreate`, `taskEdit`, `discard`, `markFresh`, `taskRetry`; the WIP commit
at every turn end; merge-in, check, `land` and `landNow` with landing refusals classified
(`classifyLandingRefusal.ts`); `startFresh`; `briefSave` and `jobSave` with rotation;
`removeCrewmate`; `deliverDraft`, `orphanScan`, `adopt`; recovery after a Mate server restart.
Every crew turn traces to a person's press.

**Show on dev** (`crewClaims.ts`, `CrewRuntime.ts`): the crewmate asks with `crew_show_on_dev`
(the request times out after 10 minutes); the person answers with `claimGrant`, `claimDeny` or
later `claimRelease`, or presses `showOnDev` on the lane bar as request and grant at once. A grant
pressed while the crewmate's turn runs waits for that turn's end, then sends the claim turn as the
person who pressed it, and keeps the request from timing out; a deny or any other move of the
claim drops it. The waiting grant is `grantWaiting` on the wire — _Waiting on you_ reads "Allowed ·
waits for <name>'s turn to end" — and a `crew_log` note, sent at boot when a restart ended the
turn. Show on dev restarts the dev server zcp started; with none, the refusal says to ask the Mate
to start it, or to open the crewmate's own app when it has a crew port.

**Runs** (`crewRuns.ts`, `crewRunFlow.ts`): `start` takes a budget, a time limit (either may be
_No limit_), an optional stop at a share of the usage window, a landing mode (`person` — you land
everything; `check` — a task lands when its check passes; `lead` — after the lead's review), the
dev grant and whether the lead may start tasks. `pause`, `resume`, `stop` and `finish` move it;
pausing or stopping interrupts every crew turn, each ending with its WIP commit. A reached limit
pauses the run with that limit as its reason; a refused dispatch pauses it with admission's words.
`resume` may carry new limits (budget, time, usage stop; an absent one keeps the run's), which a
run paused by its budget or time limit resumes with through the run dialog; a budget must exceed
what the run has spent, and a limit still reached refuses the resume by name ("The run has spent
its $3 budget — raise it or choose No limit to resume").
Spend is each crew turn's own cost: what its session's `totalCostUsd` — a running total, carried
over a resume — rose by since the last total the engine kept for that thread (a `turn-cost` note
in `crew_log`). A live session with no kept total (its turns ran before totals were logged), or
one whose total comes back below the kept one, counts nothing for that turn and counts from its
new total on. Time is wall time running, usage the fullest window of the crewmates' logins. A crew
session's `maxBudgetUsd` is what the run has left — the CLI caps a process's own spend (§8) — and
a run's start or resume restarts the crew's sessions so each takes the new cap: an idle one at
once, a working one when its turn ends. While running, the run starts queued tasks, sends rework
back, lands per its mode, nudges a turn that ended without a report once per attempt, and with the
dev grant allows a request to show on dev. A run's start or resume, and a boot inside a running
run, give every crewmate whose task stands `working` with no turn running a carry-on turn as the
run's starter; a turn the run's own pause stopped carries on in the pause's words.

**A task stopped mid-way** (`crewTurns.ts`, `crewBoot.ts`, `crewSnapshot.ts`): a turn that leaves
its task `working` ends the task's attempt — `crew_attempt.ending` is `budget`, `run-paused`,
`run-stopped`, `interrupted`, `failed` or `no-report`, with its words in `ending_detail` and
`ended_at` — and the attempt's next turn opens it again; a rework's new attempt has a row of its
own. At boot an attempt a turn left open without the engine seeing it end ends at the task's last
move. A task standing `working` with no turn running for five minutes waits on the person as a
`stalled` row, its text the attempt's words and its time when the turn ended; the feed publishes
again when the five minutes pass. Its crewmate's queue waits behind it until it lands, parks or
is discarded.

**The lead** (`crewLead.ts`): the person talks to it like any crewmate, and _Tell the crew_ goes
to its chat (`crewRouting.ts`). In a running run the engine wakes it, one wake at a time, at least
two minutes apart and at most 30 per run: for a review (`crew_review` accepts, or rejects with the
note as rework) and for a crewmate's question (`crew_report` blocked goes to the lead first; its
reply is the crewmate's next turn; a question only the person can answer reaches them at once, and
any question reaches them after 15 minutes). `crew_propose` puts tasks on the board as `proposed`
— `queued` when the run lets the lead start them — for the person's `planAccept` or
`planDiscard`; `crew_finish` ends the run. The lead's tasks start only in a running run.

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
zcp tools, no crew tools and no memory, so its task completes by the person's _Land_. Codex wraps a
command as `<shell> -lc "<command>"`; for zsh, bash or sh with `-lc` or `-c` the gate judges the
command inside, and only the exact lane form passes (`codexThreadProfile.ts`, `spi.md` §1a).

**Refusals:** a refused command reads as the engine's own sentence, never the tagged error, beside
the row that was pressed and only until the next press or ten seconds; the section's last error
is the same sentence (`failureWords` in `crewCore.ts`, `crewFailureSentence` in
`useCrewCommand.ts`); where the engine says "your Mate", the section says the Mate's name
(`crewNamingTheMate`).

**Client:** run meters show while a run is running or paused; _Start run_ is offered while no run
is on and the crew has a lead or a queued task; _+ Add lead_ whenever the crew has none; a
task that could not start offers _Try again_ (`taskRetry`) in _Waiting on you_; a task stopped
mid-way reads "Backend's task #16 stopped mid-way: <why>" and offers _Continue_ (a `message`
"Carry on with your task." as you), _Land now_ (`landNow`) and _Discard_ (`discard`).

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
