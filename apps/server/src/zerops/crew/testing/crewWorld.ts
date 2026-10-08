// @effect-diagnostics nodeBuiltinImport:off
/**
 * The crew's journeys, told once and played on either engine: the `CrewWorld` port is every step
 * a journey takes (a person presses, an agent starts and ends its turn and calls its crew tools,
 * the platform deploys, the server restarts) and everything a journey reads back (the snapshot,
 * what the crew sent into its crewmates' conversations, as whom, and the tasks it holds).
 *
 * A journey is a list of phases, `crewJourney([...])`: each phase after the first is the same Mate
 * after a server restart. `CREW_WORLD` names the world the journeys run on (`v1` unless set); the
 * V1 world drives the crew engine over `crewEngineFixture.ts`, and the engine world (CREW-DESIGN
 * §5, part D) joins `CREW_WORLDS` beside it. A sentence holds when it passes on both.
 *
 * A few journeys arrange their input through V1's own tables (an operation a crash left behind,
 * a lane row): `v1Journey` runs them on the V1 world only, through `V1CrewWorld.v1`, and `itV1`
 * skips them on any other.
 *
 * @module crewWorld
 */
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import {
  type ChatAttachment,
  type CrewCommand,
  type CrewCommandError,
  type CrewCommandResult,
  type CrewFiles,
  type CrewSnapshot,
  type OrchestrationCommand,
  type SpiEvent,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { ThreadToolProfile } from "../../../spi/threadToolPolicy.ts";
import { ServerCommandReadiness } from "../../../spi/serverCommandReadiness.ts";
import { ThreadToolPolicyRegistry } from "../../../spi/threadToolPolicy.ts";
import type { MateLogin } from "../../ZeropsLogins.ts";
import type { TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import { CrewEngine } from "../CrewEngine.ts";
import { CREW_ID } from "../CrewHome.ts";
import {
  CrewThreadDirectory,
  CrewToolHost,
  type CrewMemoryOp,
  type CrewProposedTask,
  type CrewReportInput,
  type CrewReviewInput,
  type CrewSessionStart,
  type CrewThreadMember,
  type CrewToolText,
} from "../crewSeams.ts";
import { CrewStore } from "../CrewStore.ts";
import { installCrewThreadPolicy } from "../CrewThreadPolicy.ts";
import {
  CREW_ENGINE_TEST_TIMEOUT,
  eventually,
  runningPersonThread,
  spiEvent,
  withCrewEngines,
  writeCrewHome,
  type CrewEngineServices,
  type CrewWorld as V1Fakes,
} from "./crewEngineFixture.ts";
import { engineWorld } from "./crewEngineWorld.ts";
import { AS_CREW, KAREL } from "./crewEngineSteps.ts";

export { AS_CREW, CREW_ENGINE_TEST_TIMEOUT, eventually, KAREL };

// ─── The port ──────────────────────────────────────────────────────────────────────────────────

/** The worlds a journey can run on. */
export type CrewWorldName = "v1" | "engine";

/** The world these journeys run on: `CREW_WORLD=engine` for the engine's, V1's otherwise. */
export const CREW_WORLD: CrewWorldName = process.env.CREW_WORLD === "engine" ? "engine" : "v1";

/**
 * A crewmate's conversation as its world names it: V1's stint thread, the engine's conversation.
 * A journey only ever gets one from the world (`firstTurn`, `sent`, the snapshot's
 * `currentThreadId`) and hands it back.
 */
export type CrewChat = string;

/** How a crewmate's turn ends, as its agent's provider reports it. */
export interface CrewTurnEnd {
  /** `completed` unless said. */
  readonly state?: "completed" | "interrupted" | "failed";
  /** The provider's own reason: `prompt_too_long`, `rapid_refill_breaker`, `api_error`, … */
  readonly reason?: string;
  /** What the conversation's session has spent so far, as the provider totals it. */
  readonly sessionCostUsd?: number;
}

/** What the crew sent into its crewmates' conversations, in order. */
export type CrewSent =
  /** A conversation opened for a crewmate: its `session`-th, in its copy (`null` for a reader). */
  | {
      readonly kind: "open";
      readonly chat: CrewChat;
      readonly handle: string;
      readonly session: number;
      readonly runtimeMode: string;
      readonly copy: string | null;
    }
  /** A turn started in a conversation: its words and pictures, on which login, as whom. */
  | {
      readonly kind: "turn";
      readonly chat: CrewChat;
      readonly text: string;
      readonly attachments: ReadonlyArray<ChatAttachment>;
      readonly instanceId: string | undefined;
      readonly runtimeMode: string;
    }
  | { readonly kind: "interrupt"; readonly chat: CrewChat }
  /** Its agent's session stopped. */
  | { readonly kind: "stop"; readonly chat: CrewChat }
  /** The conversation left the crewmate's chats. */
  | { readonly kind: "archive"; readonly chat: CrewChat }
  /** Its agent no longer resumes on its own when a usage window reopens. */
  | { readonly kind: "autoResume"; readonly chat: CrewChat; readonly enabled: boolean }
  /** A line in the conversation's chat between its turns: its words and its typed payload. */
  | {
      readonly kind: "seam";
      readonly chat: CrewChat;
      readonly words: string;
      readonly seam: unknown;
    }
  /** The conversation now runs in `path`; `expected` is the path a person's press saw. */
  | {
      readonly kind: "copy";
      readonly chat: CrewChat;
      readonly path: string | null | undefined;
      readonly expected: string | null | undefined;
    };

/** A step of the crew's own work a journey can stop at: `reached` once it waits there. */
export interface CrewHold {
  readonly reached: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
}

/**
 * Where a journey can hold the crew's work:
 * - `save`: a turn end's save of a crewmate's copy (the `wip(…): turn N` commit);
 * - `check`: the crewmate's check command (`test -f ok.txt` in the test crew home);
 * - `land`: a landing writing its commit onto your tree;
 * - `recover`: a deploy's end bringing the host's copies back, before it thaws;
 * - `sweep`: the boot's sweep of a copy's refs;
 * - `verdict`: the check's final read of the copy, after its command (`nth` such read);
 * - `send`: a turn on its way into a crewmate's conversation, before its agent gets it.
 */
export type CrewHoldStep =
  | { readonly step: "save" | "check" | "land" | "recover" | "sweep" | "send" }
  | { readonly step: "verdict"; readonly nth: number };

/** A task as the crew holds it, not as a frame showed it. */
export interface CrewHeldTask {
  readonly id: string;
  readonly number: number;
  readonly state: string;
  readonly attempt: number;
  readonly reworks: number;
  readonly run: string | null;
}

/** One attempt of a task: its conversation, how it ended and what it spent. */
export interface CrewHeldAttempt {
  readonly attempt: number;
  readonly chat: CrewChat | null;
  readonly rotations: number;
  readonly ending: string | null;
  readonly endingDetail: string | null;
  readonly costUsd: number;
  readonly endedAt: string | null;
}

/** What a crewmate's conversation is set up with: its tool gate and its prompt's parts. */
export type CrewChatMember = Pick<
  CrewThreadMember,
  "handle" | "live" | "gate" | "prompt" | "maxBudgetUsd" | "model" | "effort"
>;

/** A conversation as the server held it when it went down. */
export interface CrewChatWas {
  /** Its turn was still running. */
  readonly running?: boolean;
  /** Where it ran: its copy, a path a person chose, or nowhere recorded. */
  readonly worktreePath?: string | null;
}

/**
 * A crewmate's sessions as its world shows them: V1's stints, or the sessions of the engine's one
 * conversation, each begun for a reason in the crew's words.
 */
export interface CrewSessionsSeen {
  /** Sessions its conversation has had; a rotation adds one. */
  readonly count: number;
  /**
   * The latest: `active` once its agent's session started, `rotate-pending` while a rotation waits
   * for its next task, `open` otherwise.
   */
  readonly latest: "open" | "active" | "rotate-pending";
  /** Why each began, oldest first, in the crew's words; `null` for the first. */
  readonly reasons: ReadonlyArray<string | null>;
}

export interface CrewWorld {
  readonly name: CrewWorldName;
  /** The service repository the crew works in: your tree; `backend`'s copy is `.crew/backend`. */
  readonly root: string;
  /** The Mate's workspace (the container's `/var/www`): the crew home lives here. */
  readonly workspace: string;
  /** zcp's dev-server pidfile, as this world's crew reads it. */
  readonly devServerPidFile: string;
  /** Where the server stores a chat's pictures and files. */
  readonly attachmentsDir: string;
  /** Writes the crew home's files: one writer `backend` on the test service, and `files` over it. */
  readonly writeHome: (files?: Readonly<Record<string, string>>) => void;

  // A person.
  /** A press of the person's, as `KAREL` unless said. */
  readonly press: (
    input: CrewCommand,
    as?: TurnPrincipal,
  ) => Effect.Effect<CrewCommandResult, CrewCommandError>;
  /** Opens the crew home's files. */
  readonly readFiles: Effect.Effect<CrewFiles, CrewCommandError>;

  // The server.
  /** The server finishes starting: it may send turns now. */
  readonly serverReady: Effect.Effect<void>;

  // A crewmate's agent, in its conversation; each step returns once the crew has taken it in.
  readonly turnStarts: (chat: CrewChat) => Effect.Effect<void>;
  readonly turnEnds: (chat: CrewChat, end?: CrewTurnEnd) => Effect.Effect<void>;
  /** The provider delivers the conversation's latest turn end again, as after a reconnect. */
  readonly turnEndRedelivered: (chat: CrewChat) => Effect.Effect<void>;
  /** The agent's answer in its turn. */
  readonly says: (chat: CrewChat, text: string) => Effect.Effect<void>;
  /** The agent's conversation compacted its context. */
  readonly compacted: (chat: CrewChat) => Effect.Effect<void>;
  readonly report: (chat: CrewChat, input: CrewReportInput) => Effect.Effect<CrewToolText>;
  readonly showOnDev: (
    chat: CrewChat,
    input: { readonly reason: string },
  ) => Effect.Effect<CrewToolText>;
  readonly propose: (
    chat: CrewChat,
    tasks: ReadonlyArray<CrewProposedTask>,
  ) => Effect.Effect<CrewToolText>;
  readonly review: (chat: CrewChat, input: CrewReviewInput) => Effect.Effect<CrewToolText>;
  readonly finish: (
    chat: CrewChat,
    input: { readonly summary: string },
  ) => Effect.Effect<CrewToolText>;
  readonly memory: (chat: CrewChat, op: CrewMemoryOp) => Effect.Effect<CrewToolText>;
  /** The agent's session starts (or resumes, or compacted): what the crew adds to its context. */
  readonly sessionStart: (
    chat: CrewChat,
    event: CrewSessionStart,
  ) => Effect.Effect<string | undefined>;

  // The Mate's own conversation, the platform and the logins.
  /** A turn of the Mate's own runs (or no longer does): a landing waits for it. */
  readonly mateTurnRunning: (running: boolean) => Effect.Effect<void>;
  /**
   * The Mate deploys onto the test service with `zerops_deploy`: its call `started` (opened with
   * `item.started` as Claude and Codex do, or `item.updated` as the ACP agents do) or `finished`.
   */
  readonly deploy: (
    phase: "started" | "finished",
    options?: { readonly opens?: "item.started" | "item.updated" },
  ) => Effect.Effect<void>;
  /** The project's processes as the platform lists them; `unreadable` fails the read. */
  readonly deployState: (processes: ReadonlyArray<unknown> | "unreadable") => Effect.Effect<void>;
  /** A usage window of the Mate's agent stands at `usedPercent`. */
  readonly usage: (usedPercent: number) => Effect.Effect<void>;
  /** A login is signed in afresh: a default agent's, or an extra login's by id. */
  readonly signedIn: (
    login: "claude-code" | "codex" | { readonly extra: string },
  ) => Effect.Effect<void>;
  /** Admission refuses every turn with these words while set. */
  readonly refuseTurns: (words: string | undefined) => Effect.Effect<void>;
  /** Logins beyond the defaults, by id. */
  readonly logins: (logins: ReadonlyMap<string, MateLogin>) => Effect.Effect<void>;
  /** Logins whose agent is not live yet. */
  readonly agentsNotLive: (instanceIds: ReadonlySet<string>) => Effect.Effect<void>;
  /** How a crewmate's conversation stood when the server went down (set before a restart). */
  readonly chatWas: (chat: CrewChat, was: CrewChatWas) => Effect.Effect<void>;
  /** The task last moved at `at`: it has waited since, as far as the crew can tell. */
  readonly taskLastMovedAt: (taskId: string, at: string) => Effect.Effect<void>;
  /** Holds the crew's next such step before it runs. */
  readonly hold: (step: CrewHoldStep) => Effect.Effect<CrewHold>;

  // What a journey reads back.
  readonly snapshot: Effect.Effect<CrewSnapshot>;
  /** The first snapshot `check` holds for, the current one included; it waits on the crew. */
  readonly snapshotWhere: (
    check: (snapshot: CrewSnapshot) => boolean,
  ) => Effect.Effect<CrewSnapshot>;
  /** The crew feed: the current frame at once, then one per change. */
  readonly frames: Stream.Stream<CrewSnapshot>;
  readonly sent: Effect.Effect<ReadonlyArray<CrewSent>>;
  /** A crewmate's sessions once `check` holds for them; it waits on the crew. */
  readonly sessionsWhere: (
    handle: string,
    check: (sessions: CrewSessionsSeen) => boolean,
  ) => Effect.Effect<CrewSessionsSeen>;
  /** As whom each turn the crew started (or tried to) was asked to run, in order. */
  readonly admissions: Effect.Effect<ReadonlyArray<TurnPrincipal>>;
  readonly tasks: Effect.Effect<ReadonlyArray<CrewHeldTask>>;
  readonly attempts: (taskId: string) => Effect.Effect<ReadonlyArray<CrewHeldAttempt>>;
  /** The crew log's entries of these kinds: what the crew did, for triage. */
  readonly log: (
    kinds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>>;
  readonly member: (chat: CrewChat) => Effect.Effect<Option.Option<CrewChatMember>>;
  /** The tool profile an agent of the Claude login gets in this conversation, if any. */
  readonly toolProfile: (chat: CrewChat) => Effect.Effect<ThreadToolProfile | undefined>;
  /** Whether the crew's tool profiles are in force at all. */
  readonly toolProfilesInstalled: Effect.Effect<boolean>;
  /** How many times the crew set up its tool profiles. */
  readonly profileInstalls: Effect.Effect<number>;
  /** How many sessions the crew opened on its services (git and shell). */
  readonly serviceSessions: Effect.Effect<number>;
  /** How many times the crew read the platform's deploy state. */
  readonly deployReads: Effect.Effect<number>;
}

/** One phase of a journey: the Mate from a (re)start to the next. */
export type CrewPhase<E> = (world: CrewWorld) => Effect.Effect<void, E>;

export interface CrewJourneyOptions {
  /**
   * The crew's tool profiles are put in force as the server does (`toolProfile` reads them);
   * otherwise a world only counts their setups.
   */
  readonly toolProfiles?: boolean;
}

/**
 * Plays a journey's phases on a world. A journey's own failure and its world's (its database, its
 * migrations) are both the test's failure, so the runner dies with either.
 */
export type CrewWorldRunner = <E>(
  phases: ReadonlyArray<CrewPhase<E>>,
  options: CrewJourneyOptions,
) => Effect.Effect<void>;

// ─── The V1 world ──────────────────────────────────────────────────────────────────────────────

/** The V1 world, with V1's own tables and fakes for the journeys that arrange through them. */
export interface V1CrewWorld extends CrewWorld {
  readonly v1: {
    readonly fakes: V1Fakes;
    /** Runs `effect` against this phase's V1 engine and its tables. */
    readonly run: <A, E>(effect: Effect.Effect<A, E, CrewEngineServices>) => Effect.Effect<A, E>;
  };
}

const ZEROPS_DEPLOY = {
  name: "zerops_deploy",
  rawName: "mcp__zerops__zerops_deploy",
  server: "zerops",
  arguments: { targetService: "appdev" },
};

/** Holds the next turn V1 dispatches, before the orchestration engine takes it. */
const holdDispatch = (fakes: V1Fakes) =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* Ref.set(
      fakes.beforeDispatch,
      Ref.set(fakes.beforeDispatch, Effect.void).pipe(
        Effect.andThen(Deferred.succeed(reached, undefined)),
        Effect.andThen(Deferred.await(release)),
      ),
    );
    return {
      reached: Deferred.await(reached),
      release: Deferred.succeed(release, undefined).pipe(Effect.asVoid),
    } satisfies CrewHold;
  });

/** The ssh script each hold step stops at, on the V1 engine. */
const holdMatcher = (hold: CrewHoldStep): ((script: string) => boolean) => {
  switch (hold.step) {
    case "save":
      return (script) => script.includes("): turn ");
    case "check":
      return (script) => script.includes("test -f ok.txt");
    case "land":
      return (script) => script.includes("commit-tree");
    case "recover":
      return (script) => script.includes("worktree prune");
    case "sweep":
      return (script) => script.includes("ignoring broken ref");
    case "send":
      return () => false;
    case "verdict": {
      let reads = 0;
      return (script) => script.includes("dirty=no") && ++reads === hold.nth;
    }
  }
};

const sentOf = (command: OrchestrationCommand): CrewSent | undefined => {
  switch (command.type) {
    case "thread.crew.create":
      return {
        kind: "open",
        chat: command.threadId,
        handle: command.crew.crewmate,
        session: command.crew.stint,
        runtimeMode: command.runtimeMode,
        copy: command.worktreePath ?? null,
      };
    case "thread.turn.start":
      return {
        kind: "turn",
        chat: command.threadId,
        text: command.message.text,
        attachments: command.message.attachments,
        instanceId: command.modelSelection?.instanceId,
        runtimeMode: command.runtimeMode,
      };
    case "thread.turn.interrupt":
      return { kind: "interrupt", chat: command.threadId };
    case "thread.session.stop":
      return { kind: "stop", chat: command.threadId };
    case "thread.archive":
      return { kind: "archive", chat: command.threadId };
    case "thread.usage-auto-resume.set":
      return { kind: "autoResume", chat: command.threadId, enabled: command.enabled };
    case "thread.activity.append":
      return command.activity.kind === "crew.seam"
        ? {
            kind: "seam",
            chat: command.threadId,
            words: command.activity.summary,
            seam: command.activity.payload,
          }
        : undefined;
    case "thread.meta.update":
      return command.worktreePath === undefined
        ? undefined
        : {
            kind: "copy",
            chat: command.threadId,
            path: command.worktreePath,
            expected: command.expectedWorktreePath,
          };
    default:
      return undefined;
  }
};

/** The V1 port over one phase's engine: `context` is that engine's, `fakes` the world's. */
const v1Port = (fakes: V1Fakes, context: Context.Context<CrewEngineServices>): V1CrewWorld => {
  const run = <A, E>(effect: Effect.Effect<A, E, CrewEngineServices>) =>
    effect.pipe(Effect.provideContext(context));
  const engine = run(CrewEngine);
  const memberOf = (chat: CrewChat) =>
    run(
      Effect.flatMap(CrewThreadDirectory, (directory) => directory.memberFor(ThreadId.make(chat))),
    );
  /** A crew tool called from `chat`'s turn. */
  const tool = <A>(
    chat: CrewChat,
    call: (host: CrewToolHost["Service"], member: CrewThreadMember) => Effect.Effect<A>,
  ) =>
    Effect.gen(function* () {
      const member = yield* memberOf(chat);
      if (Option.isNone(member)) return yield* Effect.die(`no crewmate holds ${chat}`);
      return yield* run(Effect.flatMap(CrewToolHost, (host) => call(host, member.value)));
    });
  const deployEvent = (type: "item.started" | "item.updated" | "item.completed") =>
    spiEvent(
      type,
      "person-thread",
      {
        itemType: "mcp_tool_call",
        status: type === "item.completed" ? "completed" : "inProgress",
      } as never,
      { itemId: "deploy-1", toolCall: ZEROPS_DEPLOY } as never,
    );
  const snapshotWhere = (check: (snapshot: CrewSnapshot) => boolean) =>
    Effect.flatMap(engine, (service) =>
      service.snapshot.pipe(Stream.filter(check), Stream.runHead, Effect.map(Option.getOrThrow)),
    );
  /** Each conversation's latest turn end, to deliver again. */
  const lastEnds = new Map<CrewChat, SpiEvent>();
  /** A crewmate's stints as sessions: one per stint, the latest's state, each one's reason. */
  const seenOf = (snapshot: CrewSnapshot, handle: string): CrewSessionsSeen | undefined => {
    const mate = snapshot.crewmates.find((entry) => entry.handle === handle);
    if (mate === undefined) return undefined;
    const latest = mate.stints.at(-1)?.state;
    return {
      count: mate.stints.length,
      latest: latest === "active" || latest === "rotate-pending" ? latest : "open",
      reasons: mate.stints.map((stint) => stint.reason),
    };
  };
  const policy = run(Effect.flatMap(ThreadToolPolicyRegistry, (registry) => registry.current));
  return {
    name: "v1",
    root: fakes.root,
    workspace: fakes.workspace,
    devServerPidFile: fakes.devServerPidFile,
    attachmentsDir: NodePath.join(fakes.workspace, "attachments"),
    writeHome: (files) => writeCrewHome(fakes.workspace, files),
    press: (input, as = KAREL) => Effect.flatMap(engine, (service) => service.command(input, as)),
    readFiles: Effect.flatMap(engine, (service) => service.readFiles),
    serverReady: run(Effect.flatMap(ServerCommandReadiness, (ready) => ready.complete)),
    turnStarts: (chat) => fakes.publish(spiEvent("turn.started", chat, {})),
    turnEnds: (chat, end = {}) => {
      const event = spiEvent("turn.completed", chat, {
        state: end.state ?? "completed",
        ...(end.reason === undefined ? {} : { terminalReason: end.reason }),
        ...(end.sessionCostUsd === undefined ? {} : { totalCostUsd: end.sessionCostUsd }),
      } as never);
      lastEnds.set(chat, event);
      return fakes.publish(event);
    },
    turnEndRedelivered: (chat) => {
      const event = lastEnds.get(chat);
      return event === undefined ? Effect.die(`no turn of ${chat} ended`) : fakes.publish(event);
    },
    says: (chat, text) =>
      fakes
        .publish(spiEvent("content.delta", chat, { streamKind: "assistant_text", delta: text }))
        .pipe(
          Effect.andThen(
            fakes.publish(
              spiEvent("item.completed", chat, {
                itemType: "assistant_message",
                status: "completed",
              }),
            ),
          ),
        ),
    compacted: (chat) =>
      fakes.publish(spiEvent("thread.state.changed", chat, { state: "compacted" })),
    report: (chat, input) => tool(chat, (host, member) => host.report(member, input)),
    showOnDev: (chat, input) => tool(chat, (host, member) => host.showOnDev(member, input)),
    propose: (chat, tasks) => tool(chat, (host, member) => host.propose(member, tasks)),
    review: (chat, input) => tool(chat, (host, member) => host.review(member, input)),
    finish: (chat, input) => tool(chat, (host, member) => host.finish(member, input)),
    memory: (chat, op) => tool(chat, (host, member) => host.memory(member, op)),
    sessionStart: (chat, event) => tool(chat, (host, member) => host.sessionStart(member, event)),
    mateTurnRunning: (running) => Ref.set(fakes.threads, running ? [runningPersonThread()] : []),
    deploy: (phase, options = {}) =>
      fakes.publish(
        deployEvent(phase === "finished" ? "item.completed" : (options.opens ?? "item.started")),
      ),
    deployState: (processes) => Ref.set(fakes.processes, processes),
    usage: (usedPercent) =>
      fakes.publish(
        spiEvent(
          "account.rate-limits.updated",
          "a-person-thread",
          {
            limits: {
              windows: [{ id: "session", kind: "session", label: "Session", usedPercent }],
            },
          },
          { providerInstanceId: ProviderInstanceId.make("claudeAgent") },
        ),
      ),
    signedIn: (login) =>
      typeof login === "string"
        ? login === "claude-code"
          ? fakes.signedIn
          : fakes.signedInAs(login)
        : fakes.extraSignedIn(login.extra),
    refuseTurns: (words) => Ref.set(fakes.refusal, words),
    logins: (logins) => Ref.set(fakes.logins, logins),
    agentsNotLive: (instanceIds) => Ref.set(fakes.missingAgents, instanceIds),
    chatWas: (chat, was) =>
      Effect.gen(function* () {
        const opened = (yield* Ref.get(fakes.dispatched)).find(
          (entry): entry is Extract<OrchestrationCommand, { type: "thread.crew.create" }> =>
            entry.type === "thread.crew.create" && entry.threadId === chat,
        );
        const shell = {
          ...runningPersonThread(),
          id: ThreadId.make(chat),
          crew: opened?.crew,
          ...(was.running === true ? {} : { session: null, latestTurn: null }),
          ...(was.worktreePath === undefined ? {} : { worktreePath: was.worktreePath }),
        } as unknown as OrchestrationThreadShell;
        yield* Ref.update(fakes.threads, (threads) => [
          ...threads.filter((thread) => thread.id !== chat),
          shell,
        ]);
      }),
    taskLastMovedAt: (taskId, at) =>
      run(
        Effect.gen(function* () {
          const store = yield* CrewStore;
          const task = (yield* store.assignments(CREW_ID)).find((row) => row.assignment === taskId);
          if (task === undefined) return yield* Effect.die(`no task ${taskId}`);
          yield* store.putAssignment({ ...task, updatedAt: at });
        }).pipe(Effect.orDie),
      ),
    hold: (step) => (step.step === "send" ? holdDispatch(fakes) : fakes.holdSsh(holdMatcher(step))),
    snapshot: snapshotWhere(() => true),
    snapshotWhere,
    frames: Stream.unwrap(Effect.map(engine, (service) => service.snapshot)),
    sessionsWhere: (handle, check) =>
      Effect.map(
        snapshotWhere((snapshot) => {
          const seen = seenOf(snapshot, handle);
          return seen !== undefined && check(seen);
        }),
        (snapshot) => seenOf(snapshot, handle)!,
      ),
    sent: Effect.map(Ref.get(fakes.dispatched), (all) =>
      all.flatMap((command) => {
        const sent = sentOf(command);
        return sent === undefined ? [] : [sent];
      }),
    ),
    admissions: Effect.map(Ref.get(fakes.admitted), (all) => all.map((entry) => entry.principal)),
    tasks: run(
      Effect.flatMap(CrewStore, (store) => store.assignments(CREW_ID)).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            id: row.assignment,
            number: row.number,
            state: row.state,
            attempt: row.attempt,
            reworks: row.reworks,
            run: row.run,
          })),
        ),
        Effect.orDie,
      ),
    ),
    attempts: (taskId) =>
      run(
        Effect.flatMap(CrewStore, (store) => store.attemptsOf(taskId)).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              attempt: row.attempt,
              chat: row.threadId,
              rotations: row.rotations,
              ending: row.ending,
              endingDetail: row.endingDetail,
              costUsd: row.costUsd,
              endedAt: row.endedAt,
            })),
          ),
          Effect.orDie,
        ),
      ),
    log: (kinds) =>
      run(
        Effect.flatMap(CrewStore, (store) => store.logOf(CREW_ID, kinds)).pipe(
          Effect.map((rows) => rows.map((row) => ({ kind: row.kind, payload: row.payload }))),
          Effect.orDie,
        ),
      ),
    member: memberOf,
    toolProfile: (chat) =>
      Effect.flatMap(policy, (current) =>
        Option.isNone(current)
          ? Effect.succeed(undefined)
          : current.value.profileFor({
              threadId: ThreadId.make(chat),
              instanceId: ProviderInstanceId.make("claudeAgent"),
            }),
      ),
    toolProfilesInstalled: Effect.map(policy, Option.isSome),
    profileInstalls: Ref.get(fakes.installs),
    serviceSessions: Ref.get(fakes.sshCalls),
    deployReads: Ref.get(fakes.processReads),
    v1: { fakes, run },
  };
};

/** The V1 world: the crew engine over `crewEngineFixture.ts`. */
const v1Phases = <E>(
  phases: ReadonlyArray<(world: V1CrewWorld) => Effect.Effect<void, E, CrewEngineServices>>,
  options: CrewJourneyOptions,
) =>
  withCrewEngines(
    phases.map(
      (phase) => (fakes: V1Fakes) =>
        Effect.flatMap(Effect.context<CrewEngineServices>(), (context) =>
          phase(v1Port(fakes, context)),
        ),
    ),
    options.toolProfiles === true ? { installer: () => installCrewThreadPolicy } : {},
  ).pipe(Effect.orDie);

/** Every world the journeys run on. */
export const CREW_WORLDS: Partial<Record<CrewWorldName, CrewWorldRunner>> = {
  v1: v1Phases,
  engine: engineWorld,
};

/**
 * Plays a journey on `CREW_WORLD`: one phase, or several with a server restart between each two.
 */
export const crewJourney = <E>(
  phases: CrewPhase<E> | ReadonlyArray<CrewPhase<E>>,
  options: CrewJourneyOptions = {},
): Effect.Effect<void> => {
  const runner = CREW_WORLDS[CREW_WORLD];
  if (runner === undefined) return Effect.die(`no ${CREW_WORLD} world to play the journey on`);
  return runner(typeof phases === "function" ? [phases] : phases, options);
};

/**
 * Plays a journey that arranges through V1's own tables: on the V1 world only (see `itV1`), each
 * phase with V1's engine services at hand.
 */
export const v1Journey = <E>(
  phases:
    | ((world: V1CrewWorld) => Effect.Effect<void, E, CrewEngineServices>)
    | ReadonlyArray<(world: V1CrewWorld) => Effect.Effect<void, E, CrewEngineServices>>,
  options: CrewJourneyOptions = {},
): Effect.Effect<void> => v1Phases(typeof phases === "function" ? [phases] : phases, options);

/**
 * A check of V1's own mechanism inside a journey every world plays (an operation's record): it runs
 * on the V1 world, and the other worlds have no such mechanism to check.
 */
export const onV1 = (
  world: CrewWorld,
  check: (world: V1CrewWorld) => Effect.Effect<void>,
): Effect.Effect<void> => ("v1" in world ? check(world as V1CrewWorld) : Effect.void);

/** What `read` gives on the V1 world; `undefined` on any other. */
export const onV1Value = <A, E>(
  world: CrewWorld,
  read: (world: V1CrewWorld) => Effect.Effect<A, E>,
): Effect.Effect<A | undefined> =>
  "v1" in world ? Effect.orDie(read(world as V1CrewWorld)) : Effect.succeed(undefined);

/** A test of a `v1Journey`: it runs where the journeys run on V1, and is skipped elsewhere. */
export const itV1 = it.live.skipIf(CREW_WORLD !== "v1");

// ─── Steps over the port ───────────────────────────────────────────────────────────────────────

/** What the crew sent of one kind. */
export const sentKind = <K extends CrewSent["kind"]>(world: CrewWorld, kind: K) =>
  Effect.map(world.sent, (all) =>
    all.filter((entry): entry is Extract<CrewSent, { readonly kind: K }> => entry.kind === kind),
  );

/** Every turn the crew started. */
export const turnsSent = (world: CrewWorld) => sentKind(world, "turn");

/** Every conversation the crew opened. */
export const opened = (world: CrewWorld) => sentKind(world, "open");

/** The seam lines the crew wrote into crewmates' chats: conversation, words, payload. */
export const seamsOf = (world: CrewWorld) =>
  Effect.map(sentKind(world, "seam"), (all) =>
    all.map((entry) => [entry.chat, entry.words, entry.seam] as const),
  );

/** As whom the crew's latest turn was asked to run. */
export const lastAdmitted = (world: CrewWorld) => Effect.map(world.admissions, (all) => all.at(-1));

export const everyCopyReady = (snapshot: CrewSnapshot) =>
  snapshot.status === "applied" &&
  snapshot.crewmates.every((mate) => mate.readOnly || mate.lane?.state === "ready");

/** Applies the crew home and waits until every copy is ready. */
export const applied = (world: CrewWorld) =>
  Effect.gen(function* () {
    world.writeHome();
    yield* world.press({ _tag: "apply" });
    yield* world.snapshotWhere(everyCopyReady);
  });

/** A press once the crewmate's copy is free: the boot's own work may hold it a moment. */
export const pressWhenFree = (world: CrewWorld, input: CrewCommand) =>
  eventually(
    world.press(input).pipe(
      Effect.as(true),
      Effect.catchTag("CrewCommandError", (error) =>
        error.detail?.includes("is busy") === true ? Effect.succeed(false) : Effect.fail(error),
      ),
    ),
  );

/** A press tried until the crew takes it. */
export const pressUntilTaken = (world: CrewWorld, input: CrewCommand) =>
  eventually(
    world.press(input).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  );

/** The conversation the crew opened for `handle`. */
export const chatOf = (world: CrewWorld, handle = "backend") =>
  Effect.map(opened(world), (all) => all.find((entry) => entry.handle === handle)?.chat);

/** Opens a task with a message and starts its first turn, with `edit` made in the copy. */
export const firstTurn = (world: CrewWorld, edit: () => void) =>
  Effect.gen(function* () {
    yield* world.press({
      _tag: "message",
      handle: "backend",
      text: "Change a.txt",
      attachments: [],
    });
    const chat = yield* chatOf(world);
    if (chat === undefined) return yield* Effect.die("the message opened no conversation");
    yield* world.turnStarts(chat);
    edit();
    return chat;
  });

/** The crewmate in `chat` calls `crew_report(done)`. */
export const reportDone = (world: CrewWorld, chat: CrewChat) =>
  world.report(chat, { status: "done", summary: "Done." });
