/**
 * crewLayer — crew mode as one layer (ARCHITECTURE §1 *Principle*, §2
 * *Activation*).
 *
 * Three gates, in order: not a Zerops project, or `T3CODE_ZEROPS_CREW` off,
 * builds the inert form (no fibers; the feed says `off`). Otherwise the live
 * engine runs — and still, with no crew applied, it opens no ssh session and
 * installs nothing into the thread policy registries, so every thread's
 * adapter options stay byte-identical. The policies are installed the moment
 * a crew is applied at boot or by Apply, for the engine's life.
 *
 * The live engine subscribes to the provider event bus when it is built (an
 * event before the subscription is invisible to it), waits for the server's
 * command readiness before its boot sweep, and keeps one snapshot hub: a
 * change to the crew tables or to the engine's memory rebuilds the snapshot
 * from SQLite, at most four times a second, `seq` rising across restarts.
 *
 * @module crewLayer
 */
import {
  type CrewCommand,
  type CrewCommandResult,
  type CrewLogin,
  type CrewSnapshot,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ServerConfig } from "../../config.ts";
import { ClaudeThreadExtensionRegistry } from "../../spi/claudeThreadProfile.ts";
import { ProviderRuntimeEventBus } from "../../spi/ProviderRuntimeEventBus.ts";
import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { ZeropsAgentAuth } from "../ZeropsAgentAuth.ts";
import { isZeropsEnvironment } from "../ZeropsEnvironment.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import * as CrewApp from "./CrewApp.ts";
import {
  addCrewPorts,
  adopt,
  apply,
  appRun,
  appStop,
  deliverDraft,
  orphanScan,
  removeCrewmate,
  saveBrief,
  saveJob,
  startFresh,
  type Activate,
} from "./crewApply.ts";
import { boot } from "./crewBoot.ts";
import { grantClaim, moveClaim, releaseClaim, showOnDevNow } from "./crewClaims.ts";
import * as CrewChecks from "./CrewChecks.ts";
import { DEFAULT_CREW_LOGIN, makeCrewCore, runtimeOf, type CrewCore } from "./crewCore.ts";
import {
  board,
  diff,
  finishCrewTool,
  memberFor,
  notYet,
  postCompact,
  proposeTool,
  report,
  reviewCrewTool,
  sessionStart,
  memoryTool,
  showOnDevTool,
} from "./crewDirectory.ts";
import { leadAnswered, leadAnswers, planAccept, planDiscard, reviewTask } from "./crewLead.ts";
import { CrewEngine, inertCrewEngine, type CrewEngineService } from "./CrewEngine.ts";
import * as CrewHome from "./CrewHome.ts";
import * as CrewIntegration from "./CrewIntegration.ts";
import { askRework, land, landNow } from "./crewLanding.ts";
import * as CrewMemory from "./CrewMemory.ts";
import * as CrewReads from "./CrewReads.ts";
import * as CrewRuntime from "./CrewRuntime.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import * as CrewShell from "./CrewShell.ts";
import { appliedSnapshot, crewNoneSnapshot } from "./crewSnapshot.ts";
import * as CrewStateRef from "./CrewStateRef.ts";
import * as CrewStore from "./CrewStore.ts";
import { installCrewThreadPolicy } from "./CrewThreadPolicy.ts";
import { editMemory, forgetMemory, removeMemory } from "./crewMemoryCommands.ts";
import {
  discard,
  editTask,
  markFresh,
  message,
  newTask,
  requireTask,
  retryTask,
  tell,
} from "./crewTasks.ts";
import { makeTurnHandler } from "./crewTurns.ts";
import { restoreNotes } from "./crewNotes.ts";
import { MIRRORED_TABLES } from "./crewState.ts";
import { advanceAll, retryRefused } from "./crewRunFlow.ts";
import {
  finishRun,
  pressPause,
  resumeRun,
  runOnAfterRestart,
  runView,
  startRun,
  stopRun,
} from "./crewRuns.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

/** At most four snapshots a second (ARCHITECTURE §6). */
const SNAPSHOT_INTERVAL = Duration.millis(250);

/**
 * What installs the crew's thread policies for the scope it runs in, given
 * the directory and the tool host (the tools slice's `installCrewThreadPolicy`).
 */
export type CrewPolicyInstaller = Effect.Effect<
  void,
  never,
  | Scope.Scope
  | CrewThreadDirectory
  | CrewToolHost
  | ThreadToolPolicyRegistry
  | ClaudeThreadExtensionRegistry
>;

/** The coding agent's own name, for a login that has no label of its own (the defaults). */
const AGENT_NAMES = { "claude-code": "Claude Code", codex: "Codex" } as const;

/** Each crewmate's login as the section names it: a Mate login's label, else its agent's name. */
const loginsOf = (core: CrewCore, members: ReadonlyArray<CrewStore.CrewMemberRow>) =>
  Effect.gen(function* () {
    const logins = new Map<string, CrewLogin>();
    for (const row of members) {
      const id = row.login ?? DEFAULT_CREW_LOGIN;
      const mateLogin = yield* core.logins.resolve(id);
      const agent = mateLogin?.agent ?? (yield* core.agentOf(id)) ?? "claude-code";
      logins.set(row.handle, { id, label: mateLogin?.label ?? AGENT_NAMES[agent], agent });
    }
    return logins;
  });

const buildSnapshot = (core: CrewCore, seq: number) =>
  Effect.gen(function* () {
    const { store } = core;
    const row = yield* store.getDefinition(CrewHome.CREW_ID);
    if (Option.isNone(row) || row.value.state !== "applied") {
      return crewNoneSnapshot(seq, core.memory);
    }
    const members = yield* store.members(CrewHome.CREW_ID);
    const hosts = [
      ...new Set(members.flatMap((member) => (member.host === null ? [] : [member.host]))),
    ];
    const hostRows = [];
    for (const host of hosts) {
      const found = yield* store.getHost(host);
      hostRows.push(Option.getOrElse(found, () => ({ host, crewPorts: [] })));
    }
    const memory = new Map<string, { readonly entries: number; readonly unfiled: number }>();
    for (const member of members) {
      const rows = yield* store.memory(CrewHome.CREW_ID, member.handle);
      const unfiled = rows.filter((entry) => entry.kind === "unfiled").length;
      memory.set(member.handle, { entries: rows.length - unfiled, unfiled });
    }
    const applied = yield* core.applied;
    const nowMs = yield* Clock.currentTimeMillis;
    return appliedSnapshot({
      memory,
      seq,
      run: applied === undefined ? null : runView(core, applied, nowMs),
      leadAnswers: applied !== undefined && leadAnswers(applied),
      nowMs,
      definition: row.value.spec as CrewDefinition,
      briefVersion: row.value.briefVersion,
      members,
      lanes: yield* store.lanes(CrewHome.CREW_ID),
      stints: yield* store.stints(CrewHome.CREW_ID),
      tasks: yield* store.assignments(CrewHome.CREW_ID),
      hosts: hostRows,
      claims: [...core.memory.claims].flatMap(([host, claim]) =>
        claim.handle === null
          ? []
          : [
              {
                host,
                member: claim.handle,
                state: claim.state,
                requestedAt: claim.requestedAt,
                reason: core.memory.showReasons.get(host) ?? null,
              },
            ],
      ),
      runtime: runtimeOf(core.memory, yield* loginsOf(core, members)),
    });
  });

const run = (core: CrewCore, command: CrewCommand, principal: TurnPrincipal, activate: Activate) =>
  Effect.gen(function* () {
    core.memory.lastError = null;
    const done = { _tag: "done" } satisfies CrewCommandResult as CrewCommandResult;
    switch (command._tag) {
      case "apply":
        yield* apply(core, principal, activate);
        return done;
      case "message":
        yield* message(core, principal, command);
        return done;
      case "answer":
        if (command.taskId === null) yield* leadAnswered(core, command.handle);
        yield* message(core, principal, {
          handle: command.handle,
          text: command.text,
          attachments: [],
        });
        return done;
      case "tell":
        yield* tell(core, principal, command);
        return done;
      case "taskCreate":
        yield* newTask(core, principal, command);
        return done;
      case "taskEdit":
        yield* editTask(core, command);
        return done;
      case "discard":
        yield* discard(core, command.taskId);
        return done;
      case "markFresh":
        yield* markFresh(core, command.taskId);
        return done;
      case "taskRetry":
        yield* retryTask(core, principal, command.taskId);
        return done;
      case "land":
        yield* land(core, principal, command.taskId);
        return done;
      case "landNow":
        yield* landNow(core, principal, command.taskId);
        return done;
      case "askResolve":
        yield* askRework(core, principal, command.taskId, "conflict");
        return done;
      case "askFix":
        yield* askRework(core, principal, command.taskId, "check-failed");
        return done;
      case "startFresh":
        yield* startFresh(core, command.handle);
        return done;
      case "briefSave":
        yield* saveBrief(core, principal, command.apply);
        return done;
      case "jobSave":
        yield* saveJob(core, principal, command.handle, command.apply);
        return done;
      case "removeCrewmate":
        yield* removeCrewmate(core, command.handle, command.discardUnlanded);
        return done;
      case "appRun":
        yield* appRun(core, command.handle);
        return done;
      case "appStop":
        yield* appStop(core, command.handle);
        return done;
      case "addCrewPorts":
        return yield* addCrewPorts(core, command.host, command.count);
      case "deliverDraft":
        return yield* deliverDraft(core);
      case "orphanScan":
        return yield* orphanScan(core);
      case "adopt":
        yield* adopt(core, command.host, command.branch);
        return done;
      case "claimGrant":
        yield* grantClaim(core, principal, command.host);
        return done;
      case "claimDeny":
        yield* moveClaim(core, command.host, "deny");
        return done;
      case "claimRelease":
        yield* releaseClaim(core, principal, command.host, "press");
        return done;
      case "showOnDev":
        yield* showOnDevNow(core, principal, command.handle);
        return done;
      case "memoryEdit":
        yield* editMemory(core, command.handle, command.entryId, command.text);
        return done;
      case "memoryRemove":
        yield* removeMemory(core, command.handle, command.entryId);
        return done;
      case "forgetMemory":
        yield* forgetMemory(core, command.handle);
        return done;
      case "start": {
        const { _tag: _, ...options } = command;
        yield* startRun(core, principal, options);
        yield* advanceAll(core);
        return done;
      }
      case "pause":
        yield* pressPause(core, command.runId);
        return done;
      case "resume":
        yield* resumeRun(core, command.runId);
        yield* advanceAll(core);
        return done;
      case "stop":
        yield* stopRun(core, command.runId);
        return done;
      case "finish":
        yield* finishRun(core, command.runId);
        return done;
      case "planAccept":
        yield* planAccept(core, command.taskIds);
        yield* advanceAll(core);
        return done;
      case "planDiscard":
        yield* planDiscard(core, command.taskIds);
        return done;
      case "review": {
        const task = yield* requireTask(core, command.taskId);
        yield* reviewTask(core, task, { verdict: command.verdict, note: command.note, by: null });
        yield* advanceAll(core);
        return done;
      }
    }
  }).pipe(Effect.tap(() => core.changed));

export const makeCrewEngine = (installer: CrewPolicyInstaller) =>
  Effect.gen(function* () {
    const core = yield* makeCrewCore;
    yield* restoreNotes(core);
    const bus = yield* ProviderRuntimeEventBus;
    const agentAuth = yield* ZeropsAgentAuth;
    const readiness = yield* ServerCommandReadiness;
    const policies = yield* ThreadToolPolicyRegistry;
    const extensions = yield* ClaudeThreadExtensionRegistry;
    const scope = yield* Effect.scope;

    const directory = CrewThreadDirectory.of({ memberFor: memberFor(core) });
    const toolHost = CrewToolHost.of({
      report: (member, input) => report(core, member, input),
      board: () => board(core),
      diff: (member, input) => diff(core, member, input),
      showOnDev: (member, input) => showOnDevTool(core, member, input),
      propose: (member, tasks) => proposeTool(core, member, tasks),
      review: (member, input) => reviewCrewTool(core, member, input),
      finish: () => finishCrewTool(core),
      memory: (member, op) => memoryTool(core, member, op),
      sessionStart: (member, event) => sessionStart(core, member, event),
      postCompact: (member, summary) => postCompact(core, member, summary),
    });

    let installed = false;
    const installPolicies = Effect.suspend(() =>
      installed
        ? Effect.void
        : installer.pipe(
            Effect.provideService(CrewThreadDirectory, directory),
            Effect.provideService(CrewToolHost, toolHost),
            Effect.provideService(ThreadToolPolicyRegistry, policies),
            Effect.provideService(ClaudeThreadExtensionRegistry, extensions),
            Scope.provide(scope),
            Effect.tap(() =>
              Effect.sync(() => {
                installed = true;
              }),
            ),
          ),
    );

    // A queued task admission refused may start once a sign-in or a signer changes.
    let watching = false;
    const watchSignIns = Effect.suspend(() => {
      if (watching) return Effect.void;
      watching = true;
      return Stream.merge(
        Stream.map(core.logins.changes, () => undefined),
        Stream.map(agentAuth.changes, () => undefined),
      ).pipe(
        Stream.runForEach(() =>
          retryRefused(core).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                core.memory.lastError = error.message;
              }),
            ),
          ),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      );
    });
    const activate: Activate = installPolicies.pipe(Effect.andThen(watchSignIns));

    yield* core.reload;
    if ((yield* core.applied) !== undefined) yield* activate;

    yield* bus.events.pipe(Stream.runForEach(makeTurnHandler(core)), Effect.forkIn(scope));
    yield* Effect.flatMap(core.applied, (applied) =>
      applied === undefined
        ? Effect.void
        : core.verify.pipe(
            Effect.andThen(runOnAfterRestart(core)),
            Effect.andThen(readiness.await),
            Effect.andThen(boot(core)),
          ),
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          core.memory.lastError = error.message;
        }),
      ),
      Effect.forkIn(scope),
    );

    yield* core.listDevHosts;
    let seq = yield* Clock.currentTimeMillis;
    const next = () => {
      seq += 1;
      return seq;
    };
    const rebuild = buildSnapshot(core, 0).pipe(
      Effect.map((snapshot) => ({ ...snapshot, seq: next() })),
    );
    const hub = yield* SubscriptionRef.make<CrewSnapshot>(yield* rebuild);
    const dirty = yield* Queue.dropping<void>(1);
    yield* Stream.merge(
      Stream.map(core.store.changes, (change) => {
        if (MIRRORED_TABLES.has(change.table)) core.memory.stateBehind = true;
      }),
      core.signals,
    ).pipe(
      Stream.runForEach(() => Queue.offer(dirty, undefined)),
      Effect.forkIn(scope),
    );
    yield* Queue.take(dirty).pipe(
      Effect.andThen(rebuild),
      Effect.flatMap((snapshot) => SubscriptionRef.set(hub, snapshot)),
      Effect.andThen(Effect.sleep(SNAPSHOT_INTERVAL)),
      Effect.catch((error) =>
        Effect.sync(() => {
          core.memory.lastError = error.message;
        }),
      ),
      Effect.forever,
      Effect.forkIn(scope),
    );

    const engine: CrewEngineService = {
      snapshot: SubscriptionRef.changes(hub),
      // Opening the crew home is the editor opening: the moment to read what its Service picker offers.
      readFiles: core
        .background(core.probeDevHosts)
        .pipe(Effect.andThen(Effect.map(core.home.read, (files) => ({ files })))),
      writeFiles: (files) => core.home.write(files.files),
      command: (command, principal) => run(core, command, principal, activate),
    };
    return Context.make(CrewEngine, engine).pipe(
      Context.add(CrewThreadDirectory, directory),
      Context.add(CrewToolHost, toolHost),
    );
  });

/** The crew's own services over one store and one shell, so the engine and its parts share them. */
export const crewServicesLayer = Layer.mergeAll(
  CrewWorkspace.layer,
  CrewIntegration.layer,
  CrewStateRef.layer,
  CrewApp.layer,
  CrewReads.layer,
  CrewHome.layer,
  CrewRuntime.layer,
  CrewMemory.layer,
).pipe(
  Layer.provideMerge(CrewChecks.layer),
  Layer.provideMerge(CrewShell.layer),
  Layer.provideMerge(CrewStore.layer),
);

/**
 * Crew mode off: the feed says so and every request is refused; no thread is
 * a crewmate's, and no crew tool runs.
 */
export const crewLayerInert = Layer.succeedContext(
  Context.make(CrewEngine, inertCrewEngine).pipe(
    Context.add(CrewThreadDirectory, { memberFor: () => Effect.succeed(Option.none()) }),
    Context.add(CrewToolHost, {
      report: () => notYet("crew_report"),
      board: () => notYet("crew_board"),
      diff: () => notYet("crew_diff"),
      showOnDev: () => notYet("crew_show_on_dev"),
      propose: () => notYet("crew_propose"),
      review: () => notYet("crew_review"),
      finish: () => notYet("crew_finish"),
      memory: () => notYet("crew_memory"),
      sessionStart: () => Effect.succeed(undefined),
      postCompact: () => Effect.void,
    }),
  ),
);

/** Crew mode runs live only inside a Zerops project, with its switch on (ARCHITECTURE §1 gates 1–2). */
export const crewModeOn = (config: ServerConfig["Service"]): boolean =>
  isZeropsEnvironment(config) && config.zeropsCrew;

/** The live engine behind gates 1 and 2, with `installer` for the thread policies. */
export const makeCrewLayer = (installer: CrewPolicyInstaller) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (!crewModeOn(yield* ServerConfig)) return crewLayerInert;
      return Layer.effectContext(makeCrewEngine(installer)).pipe(Layer.provide(crewServicesLayer));
    }),
  );

/**
 * Crew mode behind its gates: the thread policy for crew threads
 * (`CrewThreadPolicy`) is installed once a crew is applied, never before.
 */
export const crewLayer = makeCrewLayer(installCrewThreadPolicy);
