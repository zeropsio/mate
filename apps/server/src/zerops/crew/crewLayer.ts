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
  agentIdForDriverKind,
  agentIdForProviderInstance,
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
} from "./crewApply.ts";
import { boot } from "./crewBoot.ts";
import * as CrewChecks from "./CrewChecks.ts";
import { makeCrewCore, refuse, runtimeOf, type CrewCore } from "./crewCore.ts";
import {
  board,
  diff,
  memberFor,
  notYet,
  postCompact,
  report,
  sessionStart,
} from "./crewDirectory.ts";
import { DEFAULT_CREW_LOGIN } from "./CrewDispatch.ts";
import { CrewEngine, inertCrewEngine, type CrewEngineService } from "./CrewEngine.ts";
import * as CrewHome from "./CrewHome.ts";
import * as CrewIntegration from "./CrewIntegration.ts";
import { askRework, land, landNow } from "./crewLanding.ts";
import * as CrewReads from "./CrewReads.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import * as CrewShell from "./CrewShell.ts";
import { appliedSnapshot, crewNoneSnapshot } from "./crewSnapshot.ts";
import * as CrewStateRef from "./CrewStateRef.ts";
import * as CrewStore from "./CrewStore.ts";
import { discard, editTask, markFresh, message, newTask, retryTask, tell } from "./crewTasks.ts";
import { makeTurnHandler } from "./crewTurns.ts";
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

const loginsOf = (core: CrewCore, members: ReadonlyArray<CrewStore.CrewMemberRow>) =>
  Effect.gen(function* () {
    const logins = new Map<string, CrewLogin>();
    for (const row of members) {
      const id = row.login ?? DEFAULT_CREW_LOGIN;
      const driver = yield* core.instances.driverKindOf(id);
      logins.set(row.handle, {
        id,
        label: id === DEFAULT_CREW_LOGIN ? "" : id,
        agent: agentIdForDriverKind(driver) ?? agentIdForProviderInstance(id) ?? "claude-code",
      });
    }
    return logins;
  });

const buildSnapshot = (core: CrewCore, seq: number) =>
  Effect.gen(function* () {
    const { store } = core;
    const row = yield* store.getDefinition(CrewHome.CREW_ID);
    if (Option.isNone(row) || row.value.state !== "applied") {
      return crewNoneSnapshot(seq, core.memory.lastError);
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
    return appliedSnapshot({
      seq,
      definition: row.value.spec as CrewDefinition,
      briefVersion: row.value.briefVersion,
      members,
      lanes: yield* store.lanes(CrewHome.CREW_ID),
      stints: yield* store.stints(CrewHome.CREW_ID),
      tasks: yield* store.assignments(CrewHome.CREW_ID),
      hosts: hostRows,
      claims: [],
      runtime: runtimeOf(core.memory, yield* loginsOf(core, members)),
    });
  });

const run = (
  core: CrewCore,
  command: CrewCommand,
  principal: TurnPrincipal,
  installPolicies: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const done = { _tag: "done" } satisfies CrewCommandResult as CrewCommandResult;
    switch (command._tag) {
      case "apply":
        yield* apply(core, principal, installPolicies);
        return done;
      case "message":
        yield* message(core, principal, command);
        return done;
      case "answer":
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
      case "claimDeny":
      case "claimRelease":
      case "start":
      case "pause":
      case "resume":
      case "stop":
      case "finish":
      case "planAccept":
      case "planDiscard":
      case "review":
      case "memoryEdit":
      case "memoryRemove":
      case "forgetMemory":
        return yield* refuse("unavailable", `${command._tag} is not in this build of crew mode`);
    }
  }).pipe(Effect.tap(() => core.changed));

export const makeCrewEngine = (installer: CrewPolicyInstaller) =>
  Effect.gen(function* () {
    const core = yield* makeCrewCore;
    const bus = yield* ProviderRuntimeEventBus;
    const readiness = yield* ServerCommandReadiness;
    const policies = yield* ThreadToolPolicyRegistry;
    const extensions = yield* ClaudeThreadExtensionRegistry;
    const scope = yield* Effect.scope;

    const directory = CrewThreadDirectory.of({ memberFor: memberFor(core) });
    const toolHost = CrewToolHost.of({
      report: (member, input) => report(core, member, input),
      board: () => board(core),
      diff: (member, input) => diff(core, member, input),
      showOnDev: () => notYet("crew_show_on_dev"),
      propose: () => notYet("crew_propose"),
      review: () => notYet("crew_review"),
      finish: () => notYet("crew_finish"),
      memory: () => notYet("crew_memory"),
      sessionStart: (member, source) => sessionStart(core, member, source),
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

    yield* core.reload;
    if ((yield* core.applied) !== undefined) yield* installPolicies;

    yield* bus.events.pipe(Stream.runForEach(makeTurnHandler(core)), Effect.forkIn(scope));
    yield* readiness.await.pipe(
      Effect.andThen(
        Effect.flatMap(core.applied, (applied) =>
          applied === undefined ? Effect.void : boot(core),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          core.memory.lastError = error.message;
        }),
      ),
      Effect.forkIn(scope),
    );

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
      Stream.map(core.store.changes, () => undefined),
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
      readFiles: Effect.map(core.home.read, (files) => ({ files })),
      writeFiles: (files) => core.home.write(files.files),
      command: (command, principal) => run(core, command, principal, installPolicies),
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

/** The live engine behind gates 1 and 2, with `installer` for the thread policies. */
export const makeCrewLayer = (installer: CrewPolicyInstaller) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      if (!isZeropsEnvironment(config) || !config.zeropsCrew) return crewLayerInert;
      return Layer.effectContext(makeCrewEngine(installer)).pipe(Layer.provide(crewServicesLayer));
    }),
  );
