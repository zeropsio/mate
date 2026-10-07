/**
 * ZeropsSetup — a new Mate finishes its own setup, with no browser open.
 *
 * Two jobs, both from facts this container holds:
 *
 * - **It reports the setup** (`GET /setup.json`, `zeropsSetupSteps.ts`): the
 *   container is up; zcp enrolled the Mate with its HQ, whose credential is
 *   its Git access — or zcp's word on why not (`outcome.json`, through
 *   `ZeropsHqLink`); zcp's status file (`ZCP_STATUS_FILE`) for the runtimes;
 *   who asked for the
 *   stand-up (the Mate's birth record at its HQ, `ZeropsHqLink`) and who
 *   signed an agent in here (`ZeropsProjectSigners`) for the sign-in; the
 *   durable record for the stand-up.
 * - **It starts the stand-up**: once HQ names the person who asked for it and
 *   that person signed an agent in here, or another agent is ready to run,
 *   it sends the ask into the Mate's main
 *   conversation, admitted as that person's session exactly as their send
 *   would be (D6). Once: the record lives in the server's database, so a
 *   restart repeats nothing. No client sends one.
 *
 * HQ keeps naming who asked after the stand-up ran; the record is what says
 * it ran.
 *
 * @module ZeropsSetup
 */
import {
  CommandId,
  ConversationId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  agentIdForProviderInstance,
  type ModelSelection,
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ServerProvider,
  type ZeropsAgentId,
  type ConversationAgent,
  wakeId as standUpWakeIdOf,
} from "@t3tools/contracts";
import type { MateState } from "@t3tools/shared/mateLink";
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
import { selectionWithPreferredEffort } from "@t3tools/shared/zeropsEffort";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Semaphore from "effect/Semaphore";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { MateEngine, type ConversationView } from "../engine/MateEngine.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import { pickReadyAgentWithoutSignIn, resolveBootstrapModelSlug } from "./ZeropsBootstrapModel.ts";
import { planFirstTurnEffort } from "./firstTurnEffort.ts";
import { overlayZeropsAgentAuth } from "./zeropsAgentProviderOverlay.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsHqLink, type HqStanding } from "./ZeropsHqLink.ts";
import { ZeropsProjectSigners, type ProjectSigners } from "./ZeropsProjectSigners.ts";
import { hasSetupMarker, readServiceVariableKeys } from "./zeropsSetupMarker.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";
import {
  STAND_UP_MESSAGE,
  parseZcpStatus,
  procStartTime,
  runningStandUpProcess,
  sectionCall,
  setupDocument,
  standUpCommandIds,
  standUpDecision,
  standUpSigners,
  type GitAccess,
  type SetupDocument,
  type StandUpCall,
  type StandUpWait,
  type ZcpProcess,
  type ZcpStatus,
} from "./zeropsSetupSteps.ts";

/** How many of the latest stand-up calls are held: a section, its carry, and retries before. */
const STAND_UP_CALLS_HELD = 8;

/** The variable zcp names its status file in when it launches this server. */
export const ZCP_STATUS_FILE_VARIABLE = "ZCP_STATUS_FILE";

/** How often the server looks for the stand-up's go-ahead while it is new… */
export const STAND_UP_POLL = Duration.seconds(10);
/** …for this long… */
export const STAND_UP_FAST_FOR = Duration.minutes(30);
/** …and then, until the stand-up is settled. */
export const STAND_UP_SLOW_POLL = Duration.seconds(60);

/** The reads this needs from outside the process; a test hands in its own. */
export class ZeropsSetupReads extends Context.Service<
  ZeropsSetupReads,
  {
    /** Where the Mate stands with its HQ (`ZeropsHqLink`): who asked, or why nobody is known to. */
    readonly hq: Effect.Effect<HqStanding>;
    /** Who this server saw sign each login in (`ZeropsProjectSigners`). */
    readonly signers: Effect.Effect<ProjectSigners>;
    /** The zcp service's variables as they stand now; `undefined` when unknown. */
    readonly serviceVariables: Effect.Effect<ReadonlyArray<string> | undefined>;
    /** zcp's status file, parsed as JSON; `undefined` when absent or unreadable. */
    readonly statusFile: Effect.Effect<unknown>;
    /** Whether a process is provably gone: its PID absent, or reused under another start time. */
    readonly processGone: (process: ZcpProcess) => Effect.Effect<boolean>;
    /**
     * The provider instances as the model picker sees them: Claude Code and Codex by the
     * agent-auth feed (`overlayZeropsAgentAuth`), every other driver by its own probe.
     */
    readonly providers: Effect.Effect<ReadonlyArray<ServerProvider>>;
  }
>()("t3/zerops/ZeropsSetup/ZeropsSetupReads") {}

export class ZeropsSetup extends Context.Service<
  ZeropsSetup,
  {
    /** `GET /setup.json`'s document. */
    readonly document: Effect.Effect<SetupDocument>;
    /** zcp's status file, as this build reads it. */
    readonly status: Effect.Effect<ZcpStatus | undefined>;
    /** Whether the stand-up the file says runs lost its zcp MCP process, provably. */
    readonly standUpGone: (status: ZcpStatus | undefined) => Effect.Effect<boolean>;
    /**
     * A `zerops_standup` call an agent of this server started (`ZeropsStandUpRelay`): the turn
     * zcp's section waits on is read off the calls (`sectionCall`). Held in memory: every start of
     * the Mate's unit fails a section left running (zcp's `MarkLaunch`), so none outlives them.
     */
    readonly noteStandUpCall: (call: StandUpCall) => Effect.Effect<void>;
    /** Receipt: the initial wait ended as sent, failed, skipped or not asked. */
    readonly awaitStandUp: Effect.Effect<void>;
    /**
     * One manual attempt, only for the recorded asker after a failed send. Refused while the Mate
     * engine owns the conversation: V1 sends nothing then.
     */
    readonly retry: (subject: string) => Effect.Effect<boolean, OrchestrationDispatchCommandError>;
  }
>()("t3/zerops/ZeropsSetup") {}

interface StandUpRow {
  readonly threadId: string;
  readonly commandId: string;
  readonly startedAt: string;
  /** `RAN` and `TERMINAL` below name its sources. */
  readonly source: string;
  readonly userId: string;
}

const AGENT_INSTANCE: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "claudeAgent",
  codex: "codex",
};

/**
 * The model the stand-up runs on: the conversation's own when it is on the
 * agent the person signed in, else the project's default on that agent, else
 * that agent's default model — what the person's composer would send.
 */
export const standUpModelSelection = (
  agentId: ZeropsAgentId,
  thread: Pick<OrchestrationThreadShell, "modelSelection"> | undefined,
  projectDefault: ModelSelection | null,
): ModelSelection => {
  if (
    thread !== undefined &&
    agentIdForProviderInstance(thread.modelSelection.instanceId) === agentId
  ) {
    return thread.modelSelection;
  }
  if (
    projectDefault !== null &&
    agentIdForProviderInstance(projectDefault.instanceId) === agentId
  ) {
    return projectDefault;
  }
  const instance = AGENT_INSTANCE[agentId];
  return {
    instanceId: ProviderInstanceId.make(instance),
    model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make(instance)] ?? DEFAULT_MODEL,
  };
};

/**
 * The model the stand-up runs on when it runs on a ready agent Mate signs nobody in to: the
 * conversation's own when it is on that instance, else the project's default there, else the
 * model a new conversation would open on it (`resolveBootstrapModelSlug`).
 */
export const standUpModelSelectionOn = (
  provider: ServerProvider,
  thread: Pick<OrchestrationThreadShell, "modelSelection"> | undefined,
  projectDefault: ModelSelection | null,
): ModelSelection => {
  if (thread !== undefined && thread.modelSelection.instanceId === provider.instanceId) {
    return thread.modelSelection;
  }
  if (projectDefault !== null && projectDefault.instanceId === provider.instanceId) {
    return projectDefault;
  }
  return { instanceId: provider.instanceId, model: resolveBootstrapModelSlug(provider) };
};

export interface ZeropsSetupTimings {
  readonly poll: Duration.Duration;
  readonly fastFor: Duration.Duration;
  readonly slowPoll: Duration.Duration;
}

const TIMINGS: ZeropsSetupTimings = {
  poll: STAND_UP_POLL,
  fastFor: STAND_UP_FAST_FOR,
  slowPoll: STAND_UP_SLOW_POLL,
};

/** How long to wait before the next look, this far (ms) into the wait for the stand-up. */
export const standUpPollDelay = (
  elapsedMs: number,
  timings: ZeropsSetupTimings = TIMINGS,
): Duration.Duration =>
  elapsedMs < Duration.toMillis(timings.fastFor) ? timings.poll : timings.slowPoll;

/**
 * A record's source. `server:claimed`: a send on its way, resumed after a restart (its ids make
 * it go out once). `server`: it went out. `none` (nobody asked), `skipped` (the conversation was
 * under way): settled without one. `browser`, `browser:claimed`: a stand-up a browser sent before
 * the server stood every Mate up itself — one that ran, whatever came of it.
 */
const RAN: ReadonlySet<string> = new Set([
  "server",
  "server:claimed",
  "browser",
  "browser:claimed",
]);
/** The sources after which nothing is left to do. */
const TERMINAL: ReadonlySet<string> = new Set([
  "server:failed",
  "server",
  "browser",
  "browser:claimed",
  "none",
  "skipped",
]);

export const makeZeropsSetup = (timings: ZeropsSetupTimings = TIMINGS) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const reads = yield* ZeropsSetupReads;
    const sql = yield* SqlClient.SqlClient;
    const orchestration = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery;
    const admission = yield* ZeropsTurnAdmission;
    const readiness = yield* ServerCommandReadiness;
    const crypto = yield* Crypto.Crypto;
    const engine = yield* MateEngine;
    // The Mate engine owns the conversation: the stand-up is a wake on it, never a V1 turn.
    const onEngine = config.mateEngine === "mate";
    const environment = config.zerops;
    const projectId = environment?.projectId ?? "";
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const startedAt = yield* nowIso;
    const gitAt = yield* Ref.make<string | undefined>(undefined);
    const signinAt = yield* Ref.make<string | undefined>(undefined);
    const settled = yield* Deferred.make<void>();
    const attempts = yield* Semaphore.make(1);

    /* ---------------------------------------------------------- the record */

    const recordOf = sql<{
      readonly threadId: string;
      readonly commandId: string;
      readonly startedAt: string;
      readonly source: string;
      readonly userId: string;
    }>`
    SELECT thread_id AS "threadId", command_id AS "commandId", started_at AS "startedAt",
      source, user_id AS "userId"
    FROM zerops_stand_ups WHERE project_id = ${projectId}
  `.pipe(
      Effect.map((rows): StandUpRow | undefined => rows[0]),
      Effect.catch(() => Effect.succeed(undefined)),
    );

    /** Records a stand-up unless one is recorded; whether this call recorded it. */
    const claim = (row: StandUpRow) =>
      sql`
      INSERT INTO zerops_stand_ups
        (project_id, thread_id, command_id, user_id, source, started_at)
      VALUES (${projectId}, ${row.threadId}, ${row.commandId}, ${row.userId}, ${row.source}, ${row.startedAt})
      ON CONFLICT (project_id) DO NOTHING
      RETURNING project_id
    `.pipe(
        Effect.map((inserted) => inserted.length === 1),
        Effect.catch(() => Effect.succeed(false)),
      );

    /** A send that failed is final until its asker explicitly tries again. */
    const fail = (commandId: string) =>
      sql`UPDATE zerops_stand_ups SET source = 'server:failed'
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'server:claimed'`.pipe(Effect.asVoid);

    /** A claim resumed that nobody can be sent as: settled, as nobody asked. */
    const settleTaken = (commandId: string) =>
      sql`UPDATE zerops_stand_ups SET source = 'none'
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'server:claimed'`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    /** A claim on its way went out: its record stands for good. */
    const confirm = (commandId: string) =>
      sql`UPDATE zerops_stand_ups SET source = 'server'
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'server:claimed'`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    /* ---------------------------------------------------------- the facts */

    const latch = (ref: Ref.Ref<string | undefined>, reached: boolean) =>
      Effect.gen(function* () {
        const at = yield* Ref.get(ref);
        if (at !== undefined || !reached) return at;
        const now = yield* nowIso;
        yield* Ref.set(ref, now);
        return now;
      });

    const status = Effect.map(reads.statusFile, parseZcpStatus);

    const standUpGone = (read: ZcpStatus | undefined) => {
      const process = runningStandUpProcess(read);
      return process === undefined ? Effect.succeed(false) : reads.processGone(process);
    };

    /** A turn's state as the stand-up reads it: running, or how it ended; not found, unread. */
    const turnState = (rows: ReadonlyArray<{ readonly state: string }>) => {
      const state = rows[0]?.state;
      if (state === undefined) return undefined;
      return state === "running" || state === "pending"
        ? "running"
        : state === "completed"
          ? "done"
          : "failed";
    };

    /**
     * The recorded stand-up's own turn — the one its ask started, found by its message (its ids
     * are the command's) — never the thread's latest, which a later message would make another's.
     * Asked and not started yet, it runs; not found (its thread gone), it is not read.
     */
    const turnOf = (record: StandUpRow) =>
      sql<{ readonly state: string }>`
        SELECT state FROM projection_turns
        WHERE thread_id = ${record.threadId} AND pending_message_id = ${record.commandId}
        ORDER BY row_id DESC LIMIT 1
      `.pipe(
        Effect.map(turnState),
        Effect.orElseSucceed(() => undefined),
      );

    /** The stand-up calls this server's agents started, the latest last; a few are enough. */
    const calls = yield* Ref.make<ReadonlyArray<StandUpCall>>([]);
    const noteStandUpCall = (call: StandUpCall) =>
      Ref.update(calls, (held) => [...held, call].slice(-STAND_UP_CALLS_HELD));

    /** The turn of the call zcp's section waits on (`sectionCall`). */
    const sectionTurnOf = (read: ZcpStatus | undefined) =>
      Effect.gen(function* () {
        const call = sectionCall(read, yield* Ref.get(calls));
        if (call?.turnId === undefined) return undefined;
        return yield* sql<{ readonly state: string }>`
          SELECT state FROM projection_turns
          WHERE thread_id = ${call.threadId} AND turn_id = ${call.turnId}
          ORDER BY row_id DESC LIMIT 1
        `.pipe(
          Effect.map(turnState),
          Effect.orElseSucceed(() => undefined),
        );
      });

    /** A turn's state from the engine's run, ended or not; none when it holds no such run. */
    const engineTurnState = (
      found:
        | { readonly wakeId: ReturnType<typeof standUpWakeIdOf> }
        | { readonly providerTurnId: string },
    ) =>
      Effect.map(engine.runOf(found), (run) =>
        run === undefined
          ? undefined
          : run.end === null
            ? ("running" as const)
            : run.end.kind === "completed"
              ? ("done" as const)
              : ("failed" as const),
      );

    /**
     * A stand-up V1 ran before the flip: how its turn ended, read once from V1's projection; one
     * V1 still says runs was cut by the switch (V1 runs nothing now, its reconcile is parked).
     */
    const v1TurnAtFlip = (record: StandUpRow) =>
      Effect.map(turnOf(record), (state) => (state === "running" ? ("failed" as const) : state));

    /** The stand-up's own run: the engine's, while it owns the conversation; else V1's turn. */
    const standUpTurnOf = (record: StandUpRow) =>
      onEngine
        ? Effect.flatMap(
            engineTurnState({
              wakeId: standUpWakeIdOf(
                ConversationId.make(record.threadId),
                "standup",
                record.commandId,
              ),
            }),
            (state) => (state === undefined ? v1TurnAtFlip(record) : Effect.succeed(state)),
          )
        : turnOf(record);

    /** The turn zcp's section waits on: the engine's run that turn went into, else V1's. */
    const sectionStateOf = (read: ZcpStatus | undefined) =>
      Effect.gen(function* () {
        if (onEngine) {
          const call = sectionCall(read, yield* Ref.get(calls));
          if (call?.turnId !== undefined) {
            const state = yield* engineTurnState({ providerTurnId: call.turnId });
            if (state !== undefined) return state;
          }
        }
        return yield* sectionTurnOf(read);
      });

    const document = Effect.gen(function* () {
      const variables = yield* reads.serviceVariables;
      const standing = yield* reads.hq;
      const git = gitAccessOf(standing, yield* latch(gitAt, standing.kind !== "not-enrolled"));
      const marked = variables !== undefined && hasSetupMarker(variables);
      const record = yield* Effect.flatMap(recordOf, seenOnEngine);
      const ran = record !== undefined && RAN.has(record.source);
      const signedInAt = yield* Ref.get(signinAt);
      // Only a marked Mate whose stand-up is still pending says why it waits: a Mate made before
      // has no stand-up of the server's, and a settled one has its record.
      const pending = marked && record === undefined;
      const hq = pending ? standing : undefined;
      // Who asked, from HQ, where a marked Mate's record cannot say it: a stand-up still pending,
      // or — settled as never due — a sign-in not seen yet. One that ran has its sign-in in its
      // record.
      const mate =
        marked && (pending || (!ran && signedInAt === undefined)) && standing.kind === "linked"
          ? Option.some(standing.mate)
          : Option.none<MateState>();
      const requestedBy = Option.getOrUndefined(mate)?.standupRequestedBy ?? undefined;
      const signers = yield* reads.signers;
      const readyWithoutSignIn =
        marked && pickReadyAgentWithoutSignIn(yield* reads.providers) !== undefined;
      const signedIn =
        ran ||
        readyWithoutSignIn ||
        (Option.isSome(mate) &&
          (requestedBy === undefined
            ? Object.keys(signers).length > 0
            : standUpSigners(signers, requestedBy).length > 0));
      // The sign-in is known from a stand-up that ran, from HQ's word, or once seen: a step once
      // done stays done.
      const signinKnown = ran || marked || signedInAt !== undefined;
      const zcpStatus = yield* status;
      return setupDocument({
        now: yield* nowIso,
        startedAt,
        git,
        status: zcpStatus,
        requestedBy,
        standUpWait: hq === undefined ? undefined : standUpWaitOf(hq),
        signinAt: yield* latch(signinAt, signedIn),
        record:
          record === undefined
            ? undefined
            : {
                startedAt: record.startedAt,
                ran,
                claimed: record.source.endsWith(":claimed"),
                failed: record.source === "server:failed",
              },
        // HQ's record carries its ask from the write that made it (audit B3), and names nobody:
        // a Mate with no stand-up to run.
        nobodyAsked: hq?.kind === "linked" && hq.mate.standupRequestedBy === null,
        standUpTurn: ran ? yield* standUpTurnOf(record) : undefined,
        standUpProcessGone: yield* standUpGone(zcpStatus),
        sectionTurn: yield* sectionStateOf(zcpStatus),
        unknown: [
          ...(signinKnown ? [] : (["signin"] as const)),
          ...(marked || record !== undefined ? [] : (["standup"] as const)),
        ],
      });
    });

    /* ---------------------------------------------------------- the stand-up */

    /** Settles the stand-up as never due; whether there is nothing left to do. */
    const settle = (source: "none" | "skipped") =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        yield* claim({ threadId: "", commandId: source, userId: "", source, startedAt: at });
        return true;
      });

    /**
     * One look: starts the stand-up when it is due, or resumes one this
     * server claimed and died before sending (its ids make the engine take it
     * once); whether there is nothing left to do — only a terminal record.
     */
    const tick = () =>
      Effect.gen(function* () {
        const held = yield* recordOf;
        if (held !== undefined && TERMINAL.has(held.source)) return true;
        const resuming = held?.source === "server:claimed" ? held : undefined;
        // Until the link brings the Mate, who asked is not known: nothing is settled on that.
        const hq = yield* reads.hq;
        if (hq.kind !== "linked") return false;
        const asker = hq.mate.standupRequestedBy ?? undefined;
        const providers = yield* reads.providers;
        const ready = pickReadyAgentWithoutSignIn(providers);
        const signers = yield* reads.signers;
        // A claim resumed is sent as whoever can send it now: the person it was claimed for,
        // else the person who asked for the stand-up — the first of them who holds an agent
        // here. When none does, it went out (its message is in the conversation) or it is
        // settled as none: a claim never waits on a sign-in that may never come.
        const requestedBy =
          resuming === undefined
            ? asker
            : [resuming.userId, asker].find(
                (userId): userId is string =>
                  userId !== undefined &&
                  userId !== "" &&
                  (standUpSigners(signers, userId).length > 0 || ready !== undefined),
              );
        if (requestedBy === undefined && resuming !== undefined) {
          const thread = Option.getOrUndefined(
            yield* projection
              .getThreadShellById(ThreadId.make(resuming.threadId))
              .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
          );
          if (thread?.latestUserMessageAt != null) {
            yield* confirm(resuming.commandId);
          } else {
            yield* settleTaken(resuming.commandId);
          }
          return true;
        }
        // HQ's record carries its ask from the write that made it (audit B3): naming nobody,
        // nobody asked.
        if (requestedBy === undefined) return yield* settle("none");
        const project = Option.getOrUndefined(
          yield* projection
            .getActiveProjectByWorkspaceRoot(config.cwd)
            .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        );
        if (project === undefined) return false;
        const threads = (yield* projection.getShellSnapshot()).threads.filter(
          (thread) => thread.projectId === project.id,
        );
        const main =
          resuming === undefined
            ? resolvePrimaryConversation(threads).primary
            : threads.find((thread) => thread.id === resuming.threadId);
        // Resumed, and its stand-up is already in the conversation: it went out before.
        if (resuming !== undefined && main?.latestUserMessageAt != null) {
          yield* confirm(resuming.commandId);
          return true;
        }
        // The conversation's own instance when it is one of the ready ones.
        const readyHere = pickReadyAgentWithoutSignIn(providers, main?.modelSelection.instanceId);
        const decision = standUpDecision({
          recorded: false,
          requestedBy,
          signers: standUpSigners(signers, requestedBy),
          ready: readyHere?.instanceId,
          spoken: resuming === undefined && main?.latestUserMessageAt != null,
        });
        if (decision.kind === "spoken") return yield* settle("skipped");
        if (decision.kind !== "start") return false;

        const now = yield* nowIso;
        const threadId = ThreadId.make(
          resuming?.threadId ?? main?.id ?? (yield* crypto.randomUUIDv4),
        );
        // On the agent the person signed in, else on the ready one that needs no sign-in.
        let chosen: ModelSelection;
        if ("agentId" in decision) {
          chosen = standUpModelSelection(decision.agentId, main, project.defaultModelSelection);
        } else if (readyHere !== undefined) {
          chosen = standUpModelSelectionOn(readyHere, main, project.defaultModelSelection);
        } else {
          return false;
        }
        const ids =
          resuming === undefined
            ? standUpCommandIds(threadId)
            : { commandId: resuming.commandId, messageId: resuming.commandId };
        const standUpTurn = {
          type: "thread.turn.start",
          commandId: CommandId.make(ids.commandId),
          threadId,
          message: {
            messageId: MessageId.make(ids.messageId),
            role: "user",
            text: STAND_UP_MESSAGE,
            attachments: [],
          },
          modelSelection: chosen,
          runtimeMode: main?.runtimeMode ?? "full-access",
          interactionMode: main?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        } satisfies OrchestrationCommand;
        // The stand-up is a new conversation's first turn: Extra High unless it names an effort,
        // and the thread stores it, so a reload reads it back (D10).
        const { turn, store } = planFirstTurnEffort({
          turn: standUpTurn,
          thread: main ?? { latestTurn: null, modelSelection: chosen },
          providers,
        });
        const modelSelection = turn.modelSelection ?? chosen;
        // For the person who asked, with no session of theirs behind it: admitted while this
        // project opens for them, on an agent they signed in (D6, X3).
        const principal: TurnPrincipal = { kind: "standup", startedBy: decision.userId };
        if (resuming === undefined) {
          const claimed = yield* claim({
            threadId,
            commandId: ids.commandId,
            userId: decision.userId,
            source: "server:claimed",
            startedAt: now,
          });
          if (!claimed) return false;
        }
        const admitted = yield* admission.admit({ command: turn, principal }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logInfo("zerops setup: the stand-up was refused", {
              reason: error.message,
            }).pipe(Effect.andThen(fail(ids.commandId)), Effect.as(false)),
          ),
        );
        if (!admitted) return true;
        const sent = yield* Effect.gen(function* () {
          if (main === undefined) {
            yield* orchestration.dispatch({
              type: "thread.create",
              // Its id too, so a resumed send never opens a second conversation.
              commandId: CommandId.make(`${ids.commandId}-thread`),
              threadId,
              projectId: project.id,
              title: "New thread",
              modelSelection,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: now,
            });
          } else if (store !== undefined) {
            yield* orchestration.dispatch({
              type: "thread.meta.update",
              commandId: CommandId.make(`${ids.commandId}-effort`),
              threadId,
              modelSelection: store,
            });
          }
          yield* orchestration.dispatch(turn);
        }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("zerops setup: the stand-up did not go out", { error }).pipe(
              Effect.andThen(fail(ids.commandId)),
              Effect.as(false),
            ),
          ),
        );
        if (!sent) return true;
        yield* confirm(ids.commandId);
        yield* Effect.logInfo("zerops setup: the stand-up went out", { threadId });
        return true;
      }).pipe(
        Effect.catchCause(() =>
          Effect.gen(function* () {
            const held = yield* recordOf;
            if (held?.source !== "server:claimed") return false;
            yield* fail(held.commandId);
            return true;
          }),
        ),
      );

    /* ---------------------------------------------------------- the stand-up on the engine */

    /** The Mate's own conversation on the engine: the one its agent is the Mate's. */
    const mateConversation = Effect.map(engine.conversations, (views) =>
      views.find((view) => view.agent?.profile.kind === "mate"),
    );

    /** Whether the conversation has heard from the person, or run anything at all. */
    const spokenIn = (view: ConversationView | undefined) => view?.lastPerson != null;
    const unstarted = (view: ConversationView | undefined) =>
      view === undefined ||
      (view.activeRun === null && view.lastEnded === null && view.queued.length === 0);

    /** The conversation's agent: the instance, its driver, the model and its options. */
    const agentOf = (
      selection: ModelSelection,
      providers: ReadonlyArray<ServerProvider>,
    ): ConversationAgent => {
      const options = Array.isArray(selection.options) ? selection.options : undefined;
      return {
        instanceId: selection.instanceId,
        driver:
          providers.find((provider) => provider.instanceId === selection.instanceId)?.driver ??
          selection.instanceId,
        model: selection.model,
        ...(options === undefined || options.length === 0 ? {} : { options }),
        profile: { kind: "mate" },
      };
    };

    /** The project's default model, where a V1 project still holds one; none on a new Mate. */
    const projectDefault = projection.getActiveProjectByWorkspaceRoot(config.cwd).pipe(
      Effect.map((found) => Option.getOrUndefined(found)?.defaultModelSelection ?? null),
      Effect.orElseSucceed(() => null),
    );

    /** The wake a recorded stand-up armed, and the run it started (none until it fired). */
    const recordedRun = (record: StandUpRow) =>
      engine.runOf({
        wakeId: standUpWakeIdOf(ConversationId.make(record.threadId), "standup", record.commandId),
      });

    /**
     * The record as a reader takes it: a stand-up the engine ended before it provably reached the
     * agent (its admission refused, its session never opened, its send refused) is a failed send,
     * as V1 records one.
     */
    const seenOnEngine = (record: StandUpRow | undefined) =>
      Effect.gen(function* () {
        if (!onEngine || record?.source !== "server") return record;
        const run = yield* recordedRun(record);
        // A stand-up V1 was running at the flip was cut by the switch: its asker may try again.
        if (run === undefined) {
          return (yield* turnOf(record)) === "running"
            ? { ...record, source: "server:failed" }
            : record;
        }
        // Only a stand-up that provably never reached the agent is a failed send: one whose
        // delivery is unknown may be in the agent already, and V1 never sends one twice.
        return run.end?.kind === "failed" && run.reachedAgent === false
          ? { ...record, source: "server:failed" }
          : record;
      });

    /**
     * One look, on the engine: the same decision as V1's (who asked, who signed in, what is
     * ready, whether the conversation is under way), but the stand-up goes as a wake for the
     * principal it names — the person who asked — into the Mate's conversation, which it gives
     * its agent first. The wake's run is admitted like any run, by the engine (D6); a refusal
     * reads as V1's failed send (`seenOnEngine`), so its asker may retry.
     */
    const tickOnEngine = () =>
      Effect.gen(function* () {
        const held = yield* recordOf;
        if (held !== undefined && TERMINAL.has(held.source)) return true;
        const resuming = held?.source === "server:claimed" ? held : undefined;
        const hq = yield* reads.hq;
        if (hq.kind !== "linked") return false;
        const asker = hq.mate.standupRequestedBy ?? undefined;
        const providers = yield* reads.providers;
        const ready = pickReadyAgentWithoutSignIn(providers);
        const signers = yield* reads.signers;
        const requestedBy =
          resuming === undefined
            ? asker
            : [resuming.userId, asker].find(
                (userId): userId is string =>
                  userId !== undefined &&
                  userId !== "" &&
                  (standUpSigners(signers, userId).length > 0 || ready !== undefined),
              );
        const main =
          resuming === undefined
            ? yield* mateConversation
            : yield* engine.conversation(ConversationId.make(resuming.threadId));
        // Resumed, and its wake is in the engine already: it went out before.
        if (resuming !== undefined && (yield* recordedRun(resuming)) !== undefined) {
          yield* confirm(resuming.commandId);
          return true;
        }
        if (requestedBy === undefined && resuming !== undefined) {
          yield* spokenIn(main) ? confirm(resuming.commandId) : settleTaken(resuming.commandId);
          return true;
        }
        if (requestedBy === undefined) return yield* settle("none");
        const mainSelection =
          main?.agent === null || main?.agent === undefined || main.agent.model === null
            ? undefined
            : {
                modelSelection: {
                  instanceId: ProviderInstanceId.make(main.agent.instanceId),
                  model: main.agent.model,
                  ...(main.agent.options === undefined ? {} : { options: main.agent.options }),
                },
              };
        const readyHere = pickReadyAgentWithoutSignIn(
          providers,
          mainSelection?.modelSelection.instanceId,
        );
        const decision = standUpDecision({
          recorded: false,
          requestedBy,
          signers: standUpSigners(signers, requestedBy),
          ready: readyHere?.instanceId,
          spoken: resuming === undefined && spokenIn(main),
        });
        if (decision.kind === "spoken") return yield* settle("skipped");
        if (decision.kind !== "start") return false;

        const now = yield* nowIso;
        const conversationId = ConversationId.make(
          resuming?.threadId ?? main?.conversationId ?? (yield* crypto.randomUUIDv4),
        );
        const defaults = yield* projectDefault;
        let chosen: ModelSelection;
        if ("agentId" in decision) {
          chosen = standUpModelSelection(decision.agentId, mainSelection, defaults);
        } else if (readyHere !== undefined) {
          chosen = standUpModelSelectionOn(readyHere, mainSelection, defaults);
        } else {
          return false;
        }
        // A new conversation's first run is on Extra High unless its model names an effort (D10).
        const selection = unstarted(main)
          ? selectionWithPreferredEffort(providers, chosen)
          : chosen;
        const ids =
          resuming === undefined
            ? standUpCommandIds(conversationId)
            : { commandId: resuming.commandId, messageId: resuming.commandId };
        if (resuming === undefined) {
          const claimed = yield* claim({
            threadId: conversationId,
            commandId: ids.commandId,
            userId: decision.userId,
            source: "server:claimed",
            startedAt: now,
          });
          if (!claimed) return false;
        }
        const sent = yield* Effect.gen(function* () {
          if (!(yield* engine.assignAgent(conversationId, agentOf(selection, providers)))) {
            return false;
          }
          yield* engine.wake({
            conversationId,
            kind: "standup",
            key: ids.commandId,
            principal: { kind: "standup", startedBy: decision.userId },
            text: STAND_UP_MESSAGE,
            dueAt: yield* Clock.currentTimeMillis,
          });
          return true;
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("zerops setup: the stand-up did not go out", {
              reason: error.message,
            }).pipe(Effect.as(false)),
          ),
        );
        if (!sent) {
          yield* fail(ids.commandId);
          return true;
        }
        yield* confirm(ids.commandId);
        yield* Effect.logInfo("zerops setup: the stand-up went out on the engine", {
          conversationId,
        });
        return true;
      }).pipe(
        Effect.catchCause(() =>
          Effect.gen(function* () {
            const held = yield* recordOf;
            if (held?.source !== "server:claimed") return false;
            yield* fail(held.commandId);
            return true;
          }),
        ),
      );

    /**
     * A Mate flipped to the engine keeps its main conversation: the engine's Mate conversation
     * takes the V1 main thread's id (so its links keep working) and its agent, once, when the
     * engine holds none yet. V1's projections are only read.
     */
    const adoptAtFlip = Effect.gen(function* () {
      if (yield* Effect.map(mateConversation, (view) => view !== undefined)) return;
      const project = Option.getOrUndefined(
        yield* projection.getActiveProjectByWorkspaceRoot(config.cwd),
      );
      if (project === undefined) return;
      const main = resolvePrimaryConversation(
        (yield* projection.getShellSnapshot()).threads.filter(
          (thread) => thread.projectId === project.id,
        ),
      ).primary;
      if (main === undefined) return;
      const given = yield* engine.assignAgent(
        ConversationId.make(main.id),
        agentOf(main.modelSelection, yield* reads.providers),
      );
      if (given)
        yield* Effect.logInfo("zerops setup: the engine took the main conversation", {
          conversationId: main.id,
        });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          "zerops setup: the main conversation could not move to the engine",
          cause,
        ),
      ),
    );

    /** One look, on the engine that owns the conversation. */
    const step = () => (onEngine ? tickOnEngine() : tick());

    /** Until the stand-up is settled: fast while the Mate is new, slower after. */
    const wait = Effect.gen(function* () {
      const variables = yield* reads.serviceVariables;
      const marked = variables !== undefined && hasSetupMarker(variables);
      // A Mate the new press did not make has no stand-up of the server's, and never polls.
      if (!marked && !onEngine) {
        yield* Deferred.succeed(settled, undefined);
        return;
      }
      yield* readiness.await;
      // On the engine, a flipped Mate's main conversation moves first, so a stand-up still due
      // goes into it rather than into a new one.
      if (onEngine) yield* adoptAtFlip;
      if (!marked) {
        yield* Deferred.succeed(settled, undefined);
        return;
      }
      const since = yield* Clock.currentTimeMillis;
      while (true) {
        const upMs = (yield* Clock.currentTimeMillis) - since;
        if (yield* attempts.withPermit(step())) {
          yield* Deferred.succeed(settled, undefined);
          return;
        }
        yield* Effect.sleep(standUpPollDelay(upMs, timings));
      }
    });

    if (environment !== undefined && isZeropsEnvironment(config)) {
      yield* Effect.forkScoped(wait);
    } else if (onEngine) {
      // No stand-up outside Zerops; a flipped main conversation still moves, once the agents
      // are known.
      yield* Deferred.succeed(settled, undefined);
      yield* Effect.forkScoped(readiness.await.pipe(Effect.andThen(adoptAtFlip)));
    }

    const retry = (subject: string) =>
      attempts
        .withPermit(
          Effect.gen(function* () {
            const stored = yield* recordOf;
            const held = yield* seenOnEngine(stored);
            if (stored === undefined || held?.source !== "server:failed" || held.userId !== subject)
              return false;
            const id = `mate-standup-${held.threadId}-${yield* crypto.randomUUIDv4}`;
            const changed = yield* sql`UPDATE zerops_stand_ups
        SET source = 'server:claimed', command_id = ${id}, started_at = ${yield* nowIso}
        WHERE project_id = ${projectId} AND command_id = ${held.commandId}
          AND source = ${stored.source}
        RETURNING project_id`;
            if (changed.length === 0) return false;
            // One attempt now. If prerequisites have disappeared, end visibly rather than leave a claim.
            if (!(yield* step())) yield* fail(id);
            return true;
          }),
        )
        .pipe(Effect.catch(() => Effect.succeed(false)));

    return ZeropsSetup.of({
      document,
      status,
      standUpGone,
      noteStandUpCall,
      retry,
      awaitStandUp: Deferred.await(settled),
    });
  });

/**
 * The Mate's Git access, from where it stands with its HQ: granted since `at` once zcp holds an
 * enrollment — and still, once granted, whatever the standing says later (`at` is latched) —
 * else failed where zcp said why not, else on its way.
 */
const gitAccessOf = (standing: HqStanding, at: string | undefined): GitAccess => {
  if (at !== undefined) return { state: "done", at };
  const outcome =
    standing.kind === "not-enrolled" ? Option.getOrUndefined(standing.outcome) : undefined;
  if (outcome === undefined) return { state: "waiting" };
  return outcome.code === undefined
    ? { state: "failed", reason: outcome.state }
    : { state: "failed", reason: outcome.state, code: outcome.code };
};

/** Why a stand-up nothing started waits, from where the Mate stands with its HQ. */
const standUpWaitOf = (hq: HqStanding): StandUpWait | undefined => {
  switch (hq.kind) {
    case "not-enrolled": {
      const outcome = Option.getOrUndefined(hq.outcome);
      if (outcome?.state === "no_hq") return { reason: "no_hq" };
      return outcome?.code === undefined
        ? { reason: "not_enrolled" }
        : { reason: "not_enrolled", code: outcome.code };
    }
    case "not-linked":
      return { reason: "not_linked" };
    case "linked":
      return undefined;
  }
};

/* ------------------------------------------------------------ the live reads */

const readFileJson = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFileString(path).pipe(
    Effect.map((text): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * Whether a process zcp named is provably gone, as zcp's own liveness reads it (the work
 * sessions' `isProcessAlive`): its PID is no process, or a process whose start time is not the
 * one zcp wrote. A PID that answers but whose start time does not read — no `/proc`, as off
 * Linux, or zcp wrote none — is alive: never a death over an unreadable clock.
 */
export const zcpProcessGone = (fs: FileSystem.FileSystem, zcp: ZcpProcess) =>
  Effect.gen(function* () {
    // Signal 0 only asks: no such process is ESRCH; a process of another user answers EPERM.
    const absent = yield* Effect.try({
      try: () => process.kill(zcp.pid, 0),
      catch: (error) => (error as NodeJS.ErrnoException).code,
    }).pipe(Effect.match({ onSuccess: () => false, onFailure: (code) => code === "ESRCH" }));
    if (absent) return true;
    if (zcp.start === "") return false;
    const start = yield* fs.readFileString(`/proc/${zcp.pid}/stat`).pipe(
      Effect.map(procStartTime),
      Effect.orElseSucceed(() => undefined),
    );
    return start !== undefined && start !== zcp.start;
  });

/**
 * The live reads: who asked for the stand-up, from the link to HQ; who signed
 * each login in, as this server saw it; the zcp service's variables from the
 * platform's live env store (`/etc/zerops-zembed/env.json`, rewritten seconds
 * after a change, no restart) and this process's own environment; zcp's
 * status file from where `ZCP_STATUS_FILE` names it, and whether a process it
 * names is gone.
 */
export const liveReadsLayer = Layer.effect(
  ZeropsSetupReads,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const link = yield* ZeropsHqLink;
    const projectSigners = yield* ZeropsProjectSigners;
    const instances = yield* ProviderInstances;
    const agentAuth = yield* ZeropsAgentAuth;
    const statusFilePath = process.env[ZCP_STATUS_FILE_VARIABLE];
    return ZeropsSetupReads.of({
      hq: link.standing,
      signers: projectSigners.signers,
      serviceVariables: readServiceVariableKeys.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
      statusFile:
        statusFilePath === undefined || statusFilePath.length === 0
          ? Effect.succeed(undefined)
          : readFileJson(fs, statusFilePath),
      processGone: (zcp) => zcpProcessGone(fs, zcp),
      providers: Effect.zipWith(instances.providers, agentAuth.latest, overlayZeropsAgentAuth),
    });
  }),
);

export const layer = Layer.effect(ZeropsSetup, makeZeropsSetup());
