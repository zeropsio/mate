# Crew mode — the map

2026-09-27, as built at `62130d8ec9` on `feat/crew-mode`. What crew mode is in code and where each
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
- **reader** — read only, no service;
- **lead** — read only, at most one per crew.

Work is **tasks**. A crewmate works one task at a time and queues the rest; a message to a
crewmate with no open task opens an implicit one (`crewTasks.ts`). A reported task merges your
tree's head into the copy, runs the check on exactly the tree that would land, and waits as
`ready`; nothing lands without the person's **Land** or **Land now** (`crewLanding.ts`,
`CrewIntegration.ts`). Every crew turn is admitted as a person: the caller's session inside their
own call, `{kind: "crew", startedBy}` for a turn started later on their behalf (`CrewDispatch.ts`).

A crewmate's conversation is a **stint**: one Mate thread over one session. The crewmate, its copy
and its tasks carry across stints; a rotation retires the current stint (archive, then session
stop) and opens the next from a seed — the open task, the copy's commits since it started, the last
report (`CrewStints.ts`, `rotationDecision.ts`).

## 2. The switch

`T3CODE_ZEROPS_CREW` — `Config.Boolean`, default `true` (`apps/server/src/cli/config.ts`,
`ServerConfig.zeropsCrew`). `crewLayer.ts` applies three gates in order: outside a Zerops project,
or with the switch off, it builds the inert engine (the feed says `off` once, every request is
`unavailable`, no thread is a crewmate's). Otherwise the live engine runs, and with no crew applied
it opens no ssh session and installs nothing into the thread policy registries, so every thread's
adapter options stay byte-identical. The policies are installed once a crew is applied, at boot or
by Apply.

## 3. Where the code lives

| Layer          | Path                                                                                                                             | Holds                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire           | `packages/contracts/src/zeropsCrew.ts`, `zeropsCrewStates.ts`                                                                    | the RPC shapes (`CrewSnapshot`, `CrewCommand`, `CrewFiles`); the closed unions every crew slice shares                                               |
| Shared         | `packages/shared/src/crewHome.ts`, `crewTemplates.ts`; `userAsk.ts`                                                              | the crew home's format, parser and validation; the three starting crews; `CREW_CARD_OPENER`, which marks a server-written task card                  |
| Server engine  | `apps/server/src/zerops/crew/` — `crewLayer.ts`, `CrewEngine.ts`, `crewCore.ts`                                                  | the layer and its gates, the command switch, the snapshot hub; the engine service and its inert form; the state every engine part shares             |
|                | `crewApply.ts`, `crewTasks.ts`, `crewTurns.ts`, `crewLanding.ts`, `crewClaims.ts`, `crewBoot.ts`                                 | Apply and saves; messages, tasks and queues; provider events at turn end; merge-in, check and landing; Show on dev; restart recovery                 |
|                | `CrewDispatch.ts`, `CrewStints.ts`, `crewCards.ts`, `crewSnapshot.ts`, `crewDirectory.ts`                                        | the one crew turn builder; stints and rotation; the cards the engine writes into a chat; one feed frame; the engine's side of the seam               |
| Pure core      | `crewMachines.ts`, `crewRouting.ts`, `crewPrompt.ts`, `crewVersions.ts`, `rotationDecision.ts`, `CrewPolicy.ts`, `CrewPacket.ts` | task, run, stint and claim machines; where a message goes; the system prompt; versions and pending; when a stint rotates; the gate; packet and delta |
| Git over ssh   | `CrewShell.ts`, `CrewWorkspace.ts`, `CrewIntegration.ts`, `CrewStateRef.ts`, `CrewChecks.ts`, `CrewApp.ts`, `CrewReads.ts`       | the only way crew code reaches a dev service; lanes; merge-in, landing and ref policing; the state ref; setup and check; the crewmate's app          |
| Store          | `CrewStore.ts`, `CrewHome.ts`                                                                                                    | the crew tables plus a change feed; the crew home's files                                                                                            |
| Policy, tools  | `crewSeams.ts`, `CrewThreadPolicy.ts`, `CrewTools.ts`, `CrewRuntime.ts`, `CrewMemory.ts`                                         | `CrewThreadDirectory` and `CrewToolHost`; the SPI answer for crew threads; the in-process crew tools; the Show-on-dev claim; memory                  |
| RPC            | `registerCrewRpc.ts`                                                                                                             | the four crew RPCs, spread by `ws.ts`                                                                                                                |
| Client runtime | `packages/client-runtime/src/zerops/crew/phrases.ts`, `crew/testing/fixtures.ts`, `projections/crew.ts`                          | every crew word (R5); `crewSnapshotFixture`; `deriveCrewView` — the snapshot joined to the thread shells                                             |
| Web            | `apps/web/src/zerops/crew/`                                                                                                      | `useCrew`, `useCrewCommand`, `crewCommands`, `useCrewHome`, `crewHome` (the editors' adapter over the format)                                        |
|                | `apps/web/src/components/zerops/crew/`                                                                                           | the section, the editors, the board and the crewmate chat — rows `zerops-crew-*` in [`surfaces.json`](surfaces.json)                                 |

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
  `info/exclude`), an app's `.crew/<handle>.run.log` and `.run.pid`, `refs/t3/crew-state/main`
  (the crew files and `seq`, mirrored so they survive a zcp redeploy), attempt refs
  `refs/t3/crew/<run>/<task>/<attempt>` (`manual` for `<run>` without a run) and landing anchors
  `refs/t3/crew/landing/<task>`. A landing is one squash commit with `Crew-Lane:` and
  `Crew-Assignment:` trailers; crew commits are authored as `Zerops Mate Crew <crew@zerops.io>`.
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
restarts (`crewLayer.ts`, `crewSnapshot.ts`). Words are not on the wire: clients render codes
through `phrases.ts`.

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
  (`ZeropsLogins.ts`).
- **Crew origin on threads** — `ThreadCrewOrigin {crew, crewmate, stint}` on the thread, its shell
  and `ThreadCreatedPayload`, set once by the internal command `thread.crew.create`
  (`packages/contracts/src/orchestration.ts`, decider, projector, `ProjectionPipeline.ts`,
  `ProjectionSnapshotQuery.ts`). `ProviderCommandReactor.ts` and `CheckpointReactor.ts` keep no
  checkpoints for a crew thread; `AgentAwarenessRelay.ts` publishes no alert for one.
- **Provider SPI** — `spi/threadToolPolicy.ts`, `spi/claudeThreadProfile.ts`,
  `spi/codexThreadProfile.ts`, `spi/serverCommandReadiness.ts`; registries provided in `server.ts`,
  readiness completed in `serverRuntimeStartup.ts`. What each driver does with a profile, and the
  no-crew byte-identity snapshots: [`spi.md`](spi.md).

Client:

- **Zerops tab** — `ZeropsPanel.tsx` mounts `CrewSectionHost` after the coding agents' card; the
  section exists only while the feed's status is `none` or `applied`.
- **Right panel** — kind `crew` (`rightPanelKinds.ts`, `rightPanelStore.ts`, `RightPanelTabs.tsx`),
  `hidden` unless the Zerops panel is available and the status is `none` or `applied`.
- **Chat** — `ChatView.tsx`: the lane bar in the lifecycle strip's slot, the board in the right
  panel, and a crew thread's send as `zerops.crew.command` `message` instead of a turn start;
  `ChatHeader.tsx`: `CrewmateHeader`; `MessagesTimeline.tsx` and `conversation.logic.ts`: a message
  opening with `CREW_CARD_OPENER` drawn as a task card; `ConversationStrip.tsx`: the crew group.
- **Composer** — trigger kind `crewmate` (`composer-logic.ts`, `ComposerCommandMenu.tsx`,
  `composer-editor-mentions.ts`), offered only in _Tell the crew_.
- **Sidebar** — `SidebarZeropsTree.tsx`: the crew's faces on the Mate row. A crew thread is never
  an ordinary row: `Sidebar.tsx`, the command palette, the archived list, thread notifications,
  mobile's thread list and prompt-history recall all leave crew threads or cards out.

## 7. Phase B and phase C in this build

**Phase B — the manual crew, built:** Apply with per-crewmate progress; writers' copies with setup,
check and a crew port each (`addCrewPorts` proposes the ports the Mate's message declares; the
engine never deploys); the crewmate's app (`appRun`, `appStop`); person-started turns — `message`,
`tell`, `taskCreate`, `taskEdit`, `discard`, `markFresh`, `taskRetry`; the WIP commit at every turn
end; merge-in, check, `land` and `landNow` with landing refusals classified
(`classifyLandingRefusal.ts`); Show on dev (`claimGrant`, `claimDeny`, `claimRelease`);
`startFresh`; `briefSave` and `jobSave` with rotation; `removeCrewmate`; `deliverDraft`,
`orphanScan`, `adopt`; recovery after a Mate server restart.
Of the crew tools, `crew_report`, `crew_board`, `crew_diff` and `crew_show_on_dev` answer; which
tools a Claude crewmate gets follows its kind (`CrewTools.ts`).

**Phase C, built:** logins beyond the two defaults, each with its own home under
`~/.mate/logins/<id>` and its own signer (`ZeropsLogins.ts`); Codex crewmates, code only — no zcp
tools and no crew tools, so their tasks complete by the person's _Land_ (`spi.md`); a lead can be
declared and applied — read only, and _Tell the crew_ goes to its chat (`crewRouting.ts`);
`CrewMemory.ts` and `CrewPacket.ts` exist with their tests.

**Phase C, not in this build:**

- the engine answers `unavailable` to `start`, `pause`, `resume`, `stop`, `finish`, `planAccept`,
  `planDiscard`, `review`, `memoryEdit`, `memoryRemove` and `forgetMemory` (`crewLayer.ts`);
- `crew_propose`, `crew_review`, `crew_finish` and `crew_memory` answer "not available to this
  crew yet" (`crewDirectory.ts`, `notYet`), and no crewmate's prompt turns memory on;
- a session start gets only a new stint's rotation seed — no state packet, no resume delta
  (`crewDirectory.ts`, `sessionStart`);
- the client draws a (C) element only while the snapshot has a lead or a run, never disabled.

## 8. Measured facts

Both measured 2026-09-27 against the local Claude Code CLI 2.1.283; neither is in
[`verified.md`](verified.md) yet.

- **Probe 22 failed.** A resumed session keeps the `--append-system-prompt` it started with; an
  append passed on resume is ignored — the model quoted the old text verbatim and the cache prefix
  was reused whole. So a changed brief or job reaches a crewmate only in a new stint: `nextTurn`
  rotates at its next turn, `fresh` rotates at once between turns, `now` interrupts a running
  turn, commits its work, rotates and sends one continue turn as the person; a new login is always
  `fresh`. Model and effort reach the next turn without a rotation, since the profile reads them
  at every turn (`rotationDecision.ts`, `crewApply.ts`, `CrewStints.ts`).
- **`dontAsk` plus a `PreToolUse` allow runs the tool.** Under `--permission-mode dontAsk` a
  `PreToolUse` hook that answers `allow` runs the tool without a prompt; without the hook the call
  is denied. The crew's gate stands on it: a crew session runs in `dontAsk` with `CrewPolicy` as a
  total `PreToolUse` hook, so what the gate does not allow is denied (`CrewPolicy.ts`, `spi.md`).
