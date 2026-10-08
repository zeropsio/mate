/**
 * crewCore — what every part of the live engine shares: its services, the
 * applied crew as it was last read from the tables, and the facts it keeps
 * only in memory.
 *
 * The engine's parts (`crewApply`, `crewTasks`, `crewLanding`, `crewTurns`,
 * `crewDirectory`, `crewBoot`) are functions over one {@link CrewCore}. The
 * tables are the truth; {@link CrewCore.applied} is their read-through copy,
 * reloaded after every write that changes the crew, so the thread directory
 * answers a hook's lookup from memory (`memberFor` runs at every tool call).
 *
 * {@link EngineMemory} holds what is cheap to lose: Apply's progress, the
 * lane figures read at turn end, which crew threads have a turn running,
 * refused dispatches, shaped turns, apply choices waiting on a turn's end,
 * the dev services this Mate mounts. A restart loses it and the boot sweep
 * reads it again.
 *
 * @module crewCore
 */
import {
  CrewCommandError,
  type ChatAttachment,
  type CrewApplyChoice,
  type CrewClaimState,
  type CrewRefusalReason,
  type CrewServed,
} from "@t3tools/contracts";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { subscribeUpdateChanges } from "../../update/subscribeChanges.ts";
import { makeOwnedWork } from "../../update/OwnedWork.ts";
import {
  claimMessageAttachments,
  pendingUploadOf,
  releaseClaimedAttachments,
} from "../../orchestration/Services/MessageAttachments.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstances } from "../../spi/providerInstances.ts";
import { ZeropsLogins } from "../ZeropsLogins.ts";
import { CrewPlatformProcesses, deployStateOf, type DeployState } from "./crewDeployState.ts";
import { withPermitWithin } from "./crewLockWait.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../ZeropsRepositorySource.ts";
import {
  principalUserId,
  ZeropsTurnAdmission,
  type TurnPrincipal,
} from "../ZeropsTurnAdmission.ts";
import { ZeropsWorkspaceObserver } from "../ZeropsWorkspaceObserver.ts";
import { CrewApp } from "./CrewApp.ts";
import { CrewChecks } from "./CrewChecks.ts";
import { CREW_ID, CrewHome } from "./CrewHome.ts";
import { CrewIntegration } from "./CrewIntegration.ts";
import { CrewMemory } from "./CrewMemory.ts";
import { CrewReads } from "./CrewReads.ts";
import { CrewRuntime } from "./CrewRuntime.ts";
import { CrewShell } from "./CrewShell.ts";
import { CrewStateRef } from "./CrewStateRef.ts";
import {
  CrewStore,
  type CrewAssignmentRow,
  type CrewMemberRow,
  type CrewRunRow,
  type CrewStintRow,
} from "./CrewStore.ts";
import { CrewWorkspace } from "./CrewWorkspace.ts";
import type { GateTurn } from "./CrewPolicy.ts";
import { UNATTENDED_MS, type LaneProgress, type SnapshotRuntime } from "./crewSnapshot.ts";
import type { PromptChange } from "./crewCards.ts";
import type { Integration, LaneStats } from "./CrewReads.ts";
import type { RotationReason } from "./rotationDecision.ts";

/** A crewmate's login when neither `crew.yaml` nor the project names one. */
export const DEFAULT_CREW_LOGIN = "claudeAgent";

/** The applied crew, as the tables hold it. */
export interface AppliedCrew {
  readonly definition: CrewDefinition;
  readonly briefVersion: number;
  readonly seq: number;
  readonly flushedSeq: number;
  readonly homeHost: string | null;
  readonly members: ReadonlyMap<string, CrewMemberRow>;
  readonly stints: ReadonlyArray<CrewStintRow>;
  /** The verified repository of every writer's host. */
  readonly repositories: ReadonlyMap<string, ZeropsRepository>;
  /** The crew's latest run in any state; `undefined` before its first. */
  readonly run: CrewRunRow | undefined;
}

/** A shaped turn the gate lets through one tool shape for (CONCEPT §3.3). */
export interface ShapedTurn {
  readonly turn: Exclude<GateTurn, "work">;
  readonly devServer?: { readonly port: number; readonly command: string };
}

/** A save applied `now` to a crewmate whose turn was running: rotate and continue at its end. */
export interface PendingContinue {
  readonly startedBy: string;
  readonly change: PromptChange;
}

/** The engine's in-memory facts; see the module doc. Mutated only inside `Effect.sync`. */
export interface EngineMemory {
  readonly progress: Map<string, LaneProgress>;
  readonly laneStats: Map<string, LaneStats>;
  readonly missingLanes: Set<string>;
  /**
   * Operations a restart interrupted (`crew_operation` ids) that the engine
   * carries on itself from their last confirmed stage once their crewmate is free.
   */
  readonly resumeAtBoot: Set<string>;
  /** Crewmates whose copies the boot sweep or a deploy's recovery holds right now. */
  readonly sweeping: Set<string>;
  /** Hosts a deploy the restart cut off may still replace: frozen, their work untouched. */
  readonly deployHeld: Set<string>;
  /** Of those, the ones whose deploy could not be read for long: offered to the person to thaw. */
  readonly deployUnreadable: Set<string>;
  readonly apps: Map<string, "running" | "stopped">;
  readonly context: Map<string, { readonly tokens: number; readonly window: number }>;
  readonly delivered: Set<string>;
  readonly cantStart: Map<string, { readonly text: string; readonly at: string }>;
  /** Crew threads with a turn running. */
  readonly working: Set<string>;
  /** The last turn's terminal reason per crew thread (SPI 2.5). */
  readonly terminalReasons: Map<string, string>;
  readonly shaped: Map<string, ShapedTurn>;
  /** A pending save's apply choice per crewmate, read at its next turn. */
  readonly applyChoices: Map<string, CrewApplyChoice>;
  /** Crewmates to rotate when their running turn ends (`fresh` on a working crewmate), and why. */
  readonly freshAtTurnEnd: Map<string, RotationReason>;
  readonly continueAtTurnEnd: Map<string, PendingContinue>;
  /** Turns sent per task attempt, for its WIP commits' messages. */
  readonly turns: Map<string, number>;
  /** Tasks whose merge-in and check are running, so a second ask waits for the first. */
  readonly integrating: Set<string>;
  /** Tasks asked to integrate while their integration ran: it runs again when that one ends. */
  readonly integrateAgain: Set<string>;
  /** A Land now that found its task's integration running: the person who pressed it, by task. */
  readonly landWhenReady: Map<string, TurnPrincipal>;
  /** Tasks a run's own landing is queued or running for: one at a time per task. */
  readonly autoLanding: Set<string>;
  /** Landings (`<assignment>:<attempt>`) that took their one retry after a missing object. */
  readonly landRetried: Set<string>;
  /** Each dev service's Show-on-dev claim, as the gate's `holdsClaim` reads it. */
  readonly claims: Map<string, MemoryClaim>;
  /** What each dev service's dev server served when last read. */
  readonly served: Map<string, CrewServed>;
  /** Your tree on each dev service, as last read. */
  readonly integration: Map<string, Integration>;
  /** Why a crewmate asked to show its work on each dev service, while it asks. */
  readonly showReasons: Map<string, string>;
  /**
   * Each crew thread's session total as last reported (`totalCostUsd` is
   * cumulative per session, a resume included), and the turns counted.
   */
  readonly costSeen: Map<string, number>;
  readonly costedTurns: Set<string>;
  /** Crew threads whose session ran turns no total was kept for: the next total is history. */
  readonly costUnknown: Set<string>;
  /** Why a run's landing of each task was last held, so the crew log says each reason once. */
  readonly heldLandings: Map<string, string>;
  /** Crew threads whose session restarts at its turn's end to take a run's new budget. */
  readonly sessionRestart: Set<string>;
  /** An *Allow* pressed while its crewmate's turn ran, per dev service, sent at that turn's end. */
  readonly grantsWaiting: Map<string, TurnPrincipal>;
  /** The dev services this Mate mounts: whether each reaches a database, `null` until read. */
  readonly devHosts: Map<string, boolean | null>;
  /**
   * Since when the running run's clock counts (clock ms): it counts while a
   * crew turn runs (`crewRuns.followCrewWork`); `null` while it stands.
   */
  runningSince: number | null;
  /** The run tick is forked (`crewRuns.ensureRunTick`). */
  runTick: boolean;
  /** Each login's fullest usage window, from the provider's rate-limit events. */
  readonly usage: Map<string, number>;
  /** How each crew thread's last turn ended (`turn.completed`'s state). */
  readonly endings: Map<string, string>;
  /**
   * Crew threads a running run carries their task on in, with why: a turn
   * its own pause stopped, a new conversation after an overflow.
   */
  readonly carryOn: Map<string, string>;
  /** Task attempts a run has nudged once (`<assignment>:<attempt>`). */
  readonly nudged: Set<string>;
  /** What the lead was woken for, per lead, while that turn runs. */
  readonly leadWakes: Map<string, LeadWake>;
  /** Wakes already sent: `review:<assignment>:<attempt>`, `question:<assignment>:<asked at>`. */
  readonly woken: Set<string>;
  /** Wakes each run has spent, capped per run (CONCEPT §5 caps). */
  readonly wakeCounts: Map<string, number>;
  /** When the lead was last woken (clock ms), for the spacing between wakes. */
  lastWakeAt: number | null;
  /** A wake waits for its spacing to pass. */
  wakeWaiting: boolean;
  /** Questions the lead passed on to the person: shown at once, not after 15 minutes. */
  readonly escalated: Set<string>;
  /** The lead's own question for the person, per lead. */
  readonly leadQuestions: Map<string, { readonly text: string; readonly at: string }>;
  /** A crew thread's last assistant message, and the one streaming in. */
  readonly lastText: Map<string, string>;
  readonly textBuffer: Map<string, string>;
  /** Who last spoke to the lead; its proposed tasks start as them outside a run. */
  leadSpokenBy: string | null;
  /** Memory, a task or the run changed since the crew-state ref was last written. */
  stateBehind: boolean;
  lastError: string | null;
}

/** Why the engine woke the lead: a task to review, or a crewmate's question. */
export interface LeadWake {
  readonly kind: "review" | "question";
  readonly taskId: string;
  /** The wake's key in `woken`; a question's is its `questionKey`. */
  readonly key: string;
}

export interface MemoryClaim {
  readonly state: CrewClaimState;
  readonly handle: string | null;
  readonly grantedBy: string | null;
  readonly requestedAt: string;
}

export const makeMemory = (): EngineMemory => ({
  progress: new Map(),
  laneStats: new Map(),
  missingLanes: new Set(),
  resumeAtBoot: new Set(),
  sweeping: new Set(),
  deployHeld: new Set(),
  deployUnreadable: new Set(),
  apps: new Map(),
  context: new Map(),
  delivered: new Set(),
  cantStart: new Map(),
  working: new Set(),
  terminalReasons: new Map(),
  shaped: new Map(),
  applyChoices: new Map(),
  freshAtTurnEnd: new Map(),
  continueAtTurnEnd: new Map(),
  turns: new Map(),
  integrating: new Set(),
  integrateAgain: new Set(),
  landWhenReady: new Map(),
  autoLanding: new Set(),
  landRetried: new Set(),
  claims: new Map(),
  served: new Map(),
  integration: new Map(),
  showReasons: new Map(),
  costSeen: new Map(),
  costedTurns: new Set(),
  costUnknown: new Set(),
  heldLandings: new Map(),
  sessionRestart: new Set(),
  grantsWaiting: new Map(),
  devHosts: new Map(),
  runningSince: null,
  runTick: false,
  usage: new Map(),
  endings: new Map(),
  carryOn: new Map(),
  nudged: new Set(),
  leadWakes: new Map(),
  woken: new Set(),
  wakeCounts: new Map(),
  lastWakeAt: null,
  wakeWaiting: false,
  escalated: new Set(),
  leadQuestions: new Map(),
  lastText: new Map(),
  textBuffer: new Map(),
  leadSpokenBy: null,
  stateBehind: false,
  lastError: null,
});

/** The memory as the snapshot reads it. */
export const runtimeOf = (
  memory: EngineMemory,
  logins: SnapshotRuntime["logins"],
): SnapshotRuntime => ({
  progress: memory.progress,
  laneStats: memory.laneStats,
  missingLanes: memory.missingLanes,
  apps: memory.apps,
  context: memory.context,
  delivered: memory.delivered,
  cantStart: memory.cantStart,
  served: memory.served,
  integration: memory.integration,
  logins,
  escalated: memory.escalated,
  leadQuestions: memory.leadQuestions,
  devHosts: memory.devHosts,
  lastError: memory.lastError,
});

/** A refusal with the engine's detail. */
export const refuse = (reason: CrewRefusalReason, detail: string | null = null) =>
  new CrewCommandError({ reason, detail });

const isCrewCommandError = Schema.is(CrewCommandError);

/** A refusal's own words when it names no detail (the client's are `crewRefusalSentence`). */
const REFUSAL_WORDS: Readonly<Record<CrewRefusalReason, string>> = {
  unavailable: "Crew mode is off in this Mate",
  "no-crew": "No crew is set up yet",
  "invalid-definition": "The crew files need a fix",
  "handle-taken": "That handle is already taken",
  "no-free-disk": "The service has no free disk for another copy of the code",
  "database-undeclared":
    "A crewmate on a service with a database needs `env:` or `database: shared`",
  "no-mention": "Name a crewmate with @, or add a lead to split the work",
  "unknown-crewmate": "There is no such crewmate on the crew",
  "unknown-task": "That task is no longer on the board",
  "wrong-state": "That can't be done in its current state",
  "not-allowed": "That crewmate's turn could not start",
  "unlanded-commits": "Its copy of the code has commits that never landed",
  "login-needs-fresh": "A different login needs a fresh conversation",
  io: "The crew could not reach its files or a service",
};

/**
 * What the section's last error shows for a failure: a refusal's own
 * sentence, never its tagged message ("Crew command refused (…): …").
 */
export const failureWords = (error: { readonly message: string }): string =>
  isCrewCommandError(error) ? (error.detail ?? REFUSAL_WORDS[error.reason]) : error.message;

/** Any failure the command cannot name otherwise: the crew home or a service could not be reached. */
export const asRefusal = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, CrewCommandError, R> =>
  effect.pipe(
    Effect.mapError((error) => (isCrewCommandError(error) ? error : refuse("io", error.message))),
  );

export const makeCrewCore = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const store = yield* CrewStore;
  const crypto = yield* Crypto.Crypto;
  const repositories = yield* ZeropsRepositorySource;
  const shell = yield* CrewShell;
  const instances = yield* ProviderInstances;
  const logins = yield* ZeropsLogins;
  // The platform's process list, where the wiring gives it (a Zerops container).
  const platformProcesses = yield* Effect.serviceOption(CrewPlatformProcesses);
  const cache = yield* Ref.make<AppliedCrew | undefined>(undefined);

  /** The coding agent a login runs, read off its instance's adapter. */
  const agentOf = (login: string) => instances.agentOf(login);
  const signals = yield* PubSub.unbounded<void>();
  const memory = makeMemory();
  const scope = yield* Effect.scope;
  const updateWork = yield* makeOwnedWork;
  const numbering = yield* Semaphore.make(1);
  const stepping = yield* Semaphore.make(1);
  const opening = yield* Semaphore.make(1);
  const crewmateLocks = new Map<string, Semaphore.Semaphore>();
  const lockOf = (handle: string) => {
    let lock = crewmateLocks.get(handle);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      crewmateLocks.set(handle, lock);
    }
    return lock;
  };
  const changed = PubSub.publish(signals, undefined).pipe(Effect.asVoid);

  /** Reads the applied crew back from the tables into {@link cache}. */
  const reload = Effect.gen(function* () {
    const row = yield* store.getDefinition(CREW_ID);
    if (Option.isNone(row) || row.value.state !== "applied") {
      yield* Ref.set(cache, undefined);
      return;
    }
    const definition = row.value.spec as CrewDefinition;
    const members = new Map(
      (yield* store.members(CREW_ID)).map((member) => [member.handle, member]),
    );
    const hosts = new Set(
      [...members.values()].flatMap((member) =>
        member.kind === "writer" && member.host !== null ? [member.host] : [],
      ),
    );
    const known = new Map<string, ZeropsRepository>();
    for (const host of hosts) {
      const repository = yield* Effect.option(shell.repository(host));
      if (Option.isSome(repository)) known.set(host, repository.value);
    }
    yield* Ref.set(cache, {
      definition,
      briefVersion: row.value.briefVersion,
      seq: row.value.seq,
      flushedSeq: row.value.flushedSeq,
      homeHost: row.value.homeHost,
      members,
      stints: yield* store.stints(CREW_ID),
      repositories: known,
      run: Option.getOrUndefined(yield* store.latestRun(CREW_ID)),
    });
  });

  const observer = yield* ZeropsWorkspaceObserver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const withFiles = <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig>,
  ) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, config),
    );

  /**
   * A crew message's attachments, as a thread message's (`Normalizer.ts`):
   * each must be a pending upload — an id the sender holds, never another
   * message's stored attachment — and is claimed, copied under its thread's
   * own id, as the turn goes.
   */
  const attachments = {
    check: (sent: ReadonlyArray<ChatAttachment>) =>
      Effect.forEach(sent, (attachment) => {
        const pending = pendingUploadOf({
          attachmentsDir: config.attachmentsDir,
          attachmentId: attachment.id,
        });
        return pending.ok
          ? Effect.void
          : Effect.fail(
              refuse(
                "not-allowed",
                `Attachment '${attachment.name}' cannot be sent: ${pending.reason}.`,
              ),
            );
      }).pipe(Effect.asVoid),
    claim: (threadId: string, sent: ReadonlyArray<ChatAttachment>) =>
      withFiles(claimMessageAttachments(threadId, sent)).pipe(
        Effect.mapError((error) => refuse("not-allowed", error.message)),
      ),
    release: (claimed: ReadonlyArray<ChatAttachment>) =>
      withFiles(releaseClaimedAttachments(claimed)),
  };

  /**
   * Verifies every writer's service this process has not verified yet — a
   * server restart forgets every binding, and the shell refuses an
   * unverified service — then reads the crew again.
   */
  const verify = Effect.gen(function* () {
    const hosts = new Set(
      (yield* store.members(CREW_ID)).flatMap((member) =>
        member.kind === "writer" && member.host !== null ? [member.host] : [],
      ),
    );
    const listed = yield* repositories.list;
    for (const host of hosts) {
      if (Option.isSome(yield* Effect.option(shell.repository(host)))) continue;
      const mounted =
        listed._tag === "available"
          ? listed.repositories.find((repository) => repository.host === host)
          : undefined;
      const seen = mounted === undefined ? undefined : yield* observer.observe(mounted);
      if (seen?._tag !== "available") {
        memory.lastError = `${host} could not be verified: ${seen?.reason ?? "it is not mounted"}`;
      }
    }
    yield* reload;
  });

  const reads = yield* CrewReads;

  /** Records the mounted dev services, forgetting the unmounted, and what is known of their databases. */
  const recordDevHosts = (
    mounted: ReadonlyArray<string>,
    databases: ReadonlyMap<string, boolean>,
  ) =>
    Effect.sync(() => {
      const listed = new Set(mounted);
      for (const host of memory.devHosts.keys()) {
        if (!listed.has(host)) memory.devHosts.delete(host);
      }
      for (const host of mounted) {
        memory.devHosts.set(host, databases.get(host) ?? memory.devHosts.get(host) ?? null);
      }
    }).pipe(Effect.andThen(changed));

  /** The dev services from the mount table: no ssh, so it runs with no crew applied. */
  const listDevHosts = Effect.gen(function* () {
    const listed = yield* repositories.list;
    if (listed._tag === "available") {
      yield* recordDevHosts(
        listed.repositories.map((repository) => repository.host),
        new Map(),
      );
    }
  });

  const probing = yield* Semaphore.make(1);

  /**
   * Verifies each mounted dev service and asks whether it reaches a database.
   * It opens ssh sessions, so only a press of the person's runs it (opening
   * the crew home), never a subscription; a second press while one runs
   * adds nothing. A service that cannot be verified keeps an unknown answer.
   */
  const probeDevHosts = Effect.gen(function* () {
    const listed = yield* repositories.refresh;
    if (listed._tag !== "available") return;
    const databases = new Map<string, boolean>();
    for (const repository of listed.repositories) {
      const seen = yield* observer.observe(repository);
      if (seen._tag !== "available") continue;
      const reaches = yield* Effect.option(reads.reachesDatabase(repository.host));
      if (Option.isSome(reaches)) databases.set(repository.host, reaches.value);
    }
    yield* recordDevHosts(
      listed.repositories.map((repository) => repository.host),
      databases,
    );
  }).pipe(probing.withPermitsIfAvailable(1), Effect.asVoid);

  return {
    config,
    updateWork,
    scope,
    store,
    shell,
    repositories,
    home: yield* CrewHome,
    workspace: yield* CrewWorkspace,
    integration: yield* CrewIntegration,
    checks: yield* CrewChecks,
    app: yield* CrewApp,
    stateRef: yield* CrewStateRef,
    reads,
    runtime: yield* CrewRuntime,
    crewMemory: yield* CrewMemory,
    orchestration: yield* OrchestrationEngineService,
    projection: yield* ProjectionSnapshotQuery,
    admission: yield* ZeropsTurnAdmission,
    observer,
    attachments,
    instances,
    logins,
    agentOf,
    memory,
    applied: Ref.get(cache),
    reload,
    verify,
    /** Whether a file on this Mate's own disk exists; unreadable counts as present. */
    fileExists: (path: string) => fileSystem.exists(path).pipe(Effect.orElseSucceed(() => true)),
    recordDevHosts,
    listDevHosts,
    probeDevHosts,
    /** Tells the snapshot hub something in memory changed. */
    changed,
    /**
     * Runs `effect` beside the caller, for the life of the engine: a merge-in
     * and its check take minutes and must not hold a press or the event loop.
     * Its failure becomes the section's last error.
     */
    background: <E extends { readonly message: string }>(effect: Effect.Effect<void, E>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            memory.lastError = failureWords(error);
          }).pipe(Effect.andThen(changed)),
        ),
        updateWork.fork,
        Effect.asVoid,
      ),
    /**
     * Runs a person's press in the engine's own scope and waits for it: a
     * browser that goes away interrupts only the wait, never the landing or
     * check it started, which finishes and shows on the next frame.
     */
    inEngine: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      updateWork.join(effect),
    /** The engine is shutting down (its scope is closing): work in flight is left for the next boot. */
    shuttingDown: (): boolean => scope.state._tag === "Closed",
    signals: Stream.fromPubSub(signals),
    subscribeSignals: subscribeUpdateChanges(signals),
    /** Serializes what takes a task's `#N`: two presses at once never share a number. */
    numbered: <A, E, R>(effect: Effect.Effect<A, E, R>) => numbering.withPermits(1)(effect),
    /** One task write at a time, so a write can check the state it read is still the stored one. */
    stepping,
    /** Serializes opening a crewmate's first conversation: two callers at once open one. */
    opening: <A, E, R>(effect: Effect.Effect<A, E, R>) => opening.withPermits(1)(effect),
    /**
     * Serializes a crewmate's turn end with a press that resets its copy: the
     * turn's WIP commit and a discard's reset never run in one worktree at once.
     */
    crewmate:
      (handle: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        lockOf(handle).withPermits(1)(effect),
    /**
     * `crewmate`'s lock taken only when free: `None`, and `effect` not run,
     * while its turn end, a merge in its copy or another press holds it.
     */
    /** `crewmate`'s lock waited for at most `wait`; the work it then runs is never cut off. */
    crewmateWithin:
      (handle: string, wait: Duration.Input) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        withPermitWithin(lockOf(handle), wait)(effect),
    crewmateIfFree:
      (handle: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        lockOf(handle).withPermitsIfAvailable(1)(effect),
    /**
     * Holds every one of `handles`' copies around `effect` (the boot sweep, a
     * deploy's recovery): a press meanwhile waits its turn, and a turn's end
     * queues behind it, instead of either being refused or holding up the
     * crew's event loop.
     */
    holdingCopies: <A, E, R>(handles: ReadonlyArray<string>, effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        for (const handle of handles) memory.sweeping.add(handle);
        return handles
          .reduce((inner, handle) => lockOf(handle).withPermits(1)(inner), effect)
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                for (const handle of handles) memory.sweeping.delete(handle);
              }),
            ),
          );
      }),
    /** Whether a self-deploy onto `host` may still run, as the platform's processes say. */
    deployState: (host: string, serviceId: string | undefined): Effect.Effect<DeployState> =>
      Option.match(platformProcesses, {
        onNone: () => Effect.succeed<DeployState>("unknown"),
        onSome: (reader) =>
          reader.read.pipe(
            Effect.map((processes): DeployState =>
              processes === undefined ? "unknown" : deployStateOf(processes, { host, serviceId }),
            ),
          ),
      }),
    now: Effect.map(DateTime.now, DateTime.formatIso),
    uuid: crypto.randomUUIDv4.pipe(Effect.orDie),
  };
});

export type CrewCore = Effect.Success<typeof makeCrewCore>;

/** The login a crewmate runs on when its `crew.yaml` names none: the project's default. */
export const defaultCrewLogin = (core: CrewCore) =>
  core.projection.getActiveProjectByWorkspaceRoot(core.config.cwd).pipe(
    Effect.map(
      (project) =>
        Option.getOrUndefined(project)?.defaultModelSelection?.instanceId ?? DEFAULT_CREW_LOGIN,
    ),
    Effect.orElseSucceed(() => DEFAULT_CREW_LOGIN),
  );

/**
 * Why a dollar budget can't be kept, when an agent a crewmate runs on doesn't
 * report what its turns cost: the run's spend would leave its turns out.
 */
export const noSpendWords = (agent: string): string =>
  `${agent} doesn't report what it spends, so this crew can't keep a budget`;

/** The first agent of `logins` that doesn't report its spend, by name; `undefined` when all do. */
export const silentSpender = (core: CrewCore, logins: Iterable<string>) =>
  Effect.gen(function* () {
    for (const login of logins) {
      const agent = yield* core.agentOf(login);
      if (agent?.threadProfile?.reportsSpend !== true) return agent?.displayName ?? login;
    }
    return undefined;
  });

/** Every crewmate's login in the applied crew. */
export const appliedLogins = (applied: AppliedCrew): ReadonlyArray<string> =>
  [...applied.members.values()].map((member) => member.login ?? DEFAULT_CREW_LOGIN);

/** The applied crew, or the refusal that nothing is applied. */
export const requireApplied = (core: CrewCore) =>
  Effect.flatMap(core.applied, (applied) =>
    applied === undefined ? Effect.fail(refuse("no-crew")) : Effect.succeed(applied),
  );

export interface CrewMember {
  readonly row: CrewMemberRow;
  readonly spec: CrewMemberSpec;
}

/** A crewmate of the applied crew by handle. */
export const memberOf = (applied: AppliedCrew, handle: string): CrewMember | undefined => {
  const row = applied.members.get(handle);
  const spec = applied.definition.members.find((member) => member.handle === handle);
  return row === undefined || spec === undefined ? undefined : { row, spec };
};

export const requireMember = (applied: AppliedCrew, handle: string) => {
  const member = memberOf(applied, handle);
  return member === undefined
    ? Effect.fail(refuse("unknown-crewmate", `@${handle}`))
    : Effect.succeed(member);
};

/** A crewmate's conversation now: its newest stint that is not retired. */
export const currentStint = (applied: AppliedCrew, handle: string): CrewStintRow | undefined =>
  applied.stints.findLast((stint) => stint.member === handle && stint.retiredAt === null);

/** Whether a turn runs on the crewmate's current conversation. */
export const isWorking = (core: CrewCore, applied: AppliedCrew, handle: string): boolean => {
  const stint = currentStint(applied, handle);
  return stint !== undefined && core.memory.working.has(stint.threadId);
};

/** The Zerops user a principal stands for; a session with no such subject stands for itself. */
export const principalUser = (principal: TurnPrincipal): string =>
  principalUserId(principal) ??
  (principal.kind === "session" ? principal.subject : principal.startedBy);

/** The principal a later dispatch of a task runs as: the person whose press or message made it. */
export const laterPrincipal = (task: Pick<CrewAssignmentRow, "createdBy">): TurnPrincipal => ({
  kind: "crew",
  startedBy: task.createdBy,
});

/** The crew's lead, when it has one. */
export const leadOf = (applied: AppliedCrew): CrewMember | undefined => {
  const row = [...applied.members.values()].find((candidate) => candidate.kind === "lead");
  return row === undefined ? undefined : memberOf(applied, row.handle);
};

/** The run that lets the crew start its own turns now; `undefined` when none runs. */
export const runningRun = (applied: AppliedCrew): CrewRunRow | undefined =>
  applied.run?.state === "running" ? applied.run : undefined;

/**
 * Whom the engine's own dispatch of a task runs as: the running run's
 * starter (ARCHITECTURE §2), else the person whose press or message made it.
 */
export const dispatchPrincipal = (
  applied: AppliedCrew,
  task: Pick<CrewAssignmentRow, "createdBy">,
): TurnPrincipal => {
  const run = runningRun(applied);
  return run === undefined ? laterPrincipal(task) : { kind: "crew", startedBy: run.startedBy };
};

/** The feed again once a task nobody acts on has stood long enough to wait on the person. */
export const feedWhenUnattended = (core: CrewCore) =>
  Effect.forkIn(
    Effect.sleep(Duration.millis(UNATTENDED_MS)).pipe(Effect.andThen(core.changed)),
    core.scope,
  ).pipe(Effect.asVoid);
