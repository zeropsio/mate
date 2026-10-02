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
 *   that person signed an agent in here, it sends the ask into the Mate's main
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
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  agentIdForProviderInstance,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import type { MateState } from "@t3tools/shared/mateLink";
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsHqLink, type HqStanding } from "./ZeropsHqLink.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import { ZeropsProjectSigners, type ProjectSigners } from "./ZeropsProjectSigners.ts";
import { hasSetupMarker, readServiceVariableKeys } from "./zeropsSetupMarker.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";
import {
  STAND_UP_MESSAGE,
  parseZcpStatus,
  setupDocument,
  standUpCommandIds,
  standUpDecision,
  standUpSigners,
  type GitAccess,
  type SetupDocument,
  type StandUpWait,
  type ZcpStatus,
} from "./zeropsSetupSteps.ts";

/** The variable zcp names its status file in when it launches this server. */
export const ZCP_STATUS_FILE_VARIABLE = "ZCP_STATUS_FILE";

/** How often the server looks for the stand-up's go-ahead while it is new… */
export const STAND_UP_POLL = Duration.seconds(10);
/** …for this long… */
export const STAND_UP_FAST_FOR = Duration.minutes(30);
/** …and then, until the stand-up is settled. */
export const STAND_UP_SLOW_POLL = Duration.seconds(60);
/**
 * HQ naming nobody who asked settles the stand-up as `none` only after this
 * long up: the press records its ask as it makes the Mate, and that record
 * may still be on its way.
 */
export const STAND_UP_NONE_AFTER = Duration.minutes(5);

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
  }
>()("t3/zerops/ZeropsSetup/ZeropsSetupReads") {}

export class ZeropsSetup extends Context.Service<
  ZeropsSetup,
  {
    /** `GET /setup.json`'s document. */
    readonly document: Effect.Effect<SetupDocument>;
    /** zcp's status file, as this build reads it. */
    readonly status: Effect.Effect<ZcpStatus | undefined>;
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

export interface ZeropsSetupTimings {
  readonly poll: Duration.Duration;
  readonly fastFor: Duration.Duration;
  readonly slowPoll: Duration.Duration;
  readonly noneAfter: Duration.Duration;
}

const TIMINGS: ZeropsSetupTimings = {
  poll: STAND_UP_POLL,
  fastFor: STAND_UP_FAST_FOR,
  slowPoll: STAND_UP_SLOW_POLL,
  noneAfter: STAND_UP_NONE_AFTER,
};

/** How long to wait before the next look, this far (ms) into the wait for the stand-up. */
export const standUpPollDelay = (
  elapsedMs: number,
  timings: Pick<ZeropsSetupTimings, "poll" | "fastFor" | "slowPoll"> = TIMINGS,
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
    const environment = config.zerops;
    const projectId = environment?.projectId ?? "";
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const startedAt = yield* nowIso;
    const gitAt = yield* Ref.make<string | undefined>(undefined);
    const signinAt = yield* Ref.make<string | undefined>(undefined);

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

    /** Withdraws this server's claim on its way: never any other record. */
    const withdraw = (commandId: string) =>
      sql`DELETE FROM zerops_stand_ups
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'server:claimed'`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

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
        Effect.map((rows) => {
          const state = rows[0]?.state;
          if (state === undefined) return undefined;
          return state === "running" || state === "pending"
            ? "running"
            : state === "completed"
              ? "done"
              : "failed";
        }),
        Effect.catch(() => Effect.succeed(undefined)),
      );

    const document = Effect.gen(function* () {
      const variables = yield* reads.serviceVariables;
      const standing = yield* reads.hq;
      const git = gitAccessOf(standing, yield* latch(gitAt, standing.kind !== "not-enrolled"));
      const marked = variables !== undefined && hasSetupMarker(variables);
      const record = yield* recordOf;
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
      const signedIn =
        ran ||
        (Option.isSome(mate) &&
          (requestedBy === undefined
            ? Object.keys(signers).length > 0
            : standUpSigners(signers, requestedBy).length > 0));
      // The sign-in is known from a stand-up that ran, from HQ's word, or once seen: a step once
      // done stays done.
      const signinKnown = ran || marked || signedInAt !== undefined;
      return setupDocument({
        now: yield* nowIso,
        startedAt,
        git,
        status: yield* status,
        requestedBy,
        standUpWait: hq === undefined ? undefined : standUpWaitOf(hq),
        signinAt: yield* latch(signinAt, signedIn),
        record:
          record === undefined
            ? undefined
            : { startedAt: record.startedAt, ran, claimed: record.source.endsWith(":claimed") },
        // HQ's birth record is whole — the press records the ask before the close-off — and
        // names nobody: a Mate with no stand-up to run.
        nobodyAsked:
          hq?.kind === "linked" && hq.mate.standupRequestedBy === null && hq.mate.closedOff,
        standUpTurn: ran ? yield* turnOf(record) : undefined,
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
    const tick = (upMs: number) =>
      Effect.gen(function* () {
        const held = yield* recordOf;
        if (held !== undefined && TERMINAL.has(held.source)) return true;
        const resuming = held?.source === "server:claimed" ? held : undefined;
        // Until the link brings the Mate, who asked is not known: nothing is settled on that.
        const hq = yield* reads.hq;
        if (hq.kind !== "linked") return false;
        const asker = hq.mate.standupRequestedBy ?? undefined;
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
                  standUpSigners(signers, userId).length > 0,
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
        if (requestedBy === undefined) {
          return upMs >= Duration.toMillis(timings.noneAfter) ? yield* settle("none") : false;
        }
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
        const decision = standUpDecision({
          recorded: false,
          requestedBy,
          signers: standUpSigners(signers, requestedBy),
          spoken: resuming === undefined && main?.latestUserMessageAt != null,
        });
        if (decision.kind === "spoken") return yield* settle("skipped");
        if (decision.kind !== "start") return false;

        const now = yield* nowIso;
        const threadId = ThreadId.make(
          resuming?.threadId ?? main?.id ?? (yield* crypto.randomUUIDv4),
        );
        const modelSelection = standUpModelSelection(
          decision.agentId,
          main,
          project.defaultModelSelection,
        );
        const ids =
          resuming === undefined
            ? standUpCommandIds(threadId)
            : { commandId: resuming.commandId, messageId: resuming.commandId };
        const turn = {
          type: "thread.turn.start",
          commandId: CommandId.make(ids.commandId),
          threadId,
          message: {
            messageId: MessageId.make(ids.messageId),
            role: "user",
            text: STAND_UP_MESSAGE,
            attachments: [],
          },
          modelSelection,
          runtimeMode: main?.runtimeMode ?? "full-access",
          interactionMode: main?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        } satisfies OrchestrationCommand;
        // As the person: their session's subject, the one their own send carries (D6).
        const principal: TurnPrincipal = {
          kind: "session",
          subject: `${ZEROPS_SUBJECT_PREFIX}${decision.userId}`,
        };
        const admitted = yield* admission.admit({ command: turn, principal }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logInfo("zerops setup: the stand-up waits on admission", {
              reason: error.message,
            }).pipe(Effect.as(false)),
          ),
        );
        if (!admitted) return false;
        if (resuming === undefined) {
          const claimed = yield* claim({
            threadId,
            commandId: ids.commandId,
            userId: decision.userId,
            source: "server:claimed",
            startedAt: now,
          });
          // A browser claimed it meanwhile: look again, until its send ends.
          if (!claimed) return false;
        }
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
          }
          yield* orchestration.dispatch(turn);
        }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("zerops setup: the stand-up did not go out", { error }).pipe(
              Effect.andThen(withdraw(ids.commandId)),
              Effect.as(false),
            ),
          ),
        );
        if (!sent) return false;
        yield* confirm(ids.commandId);
        yield* Effect.logInfo("zerops setup: the stand-up went out", { threadId });
        return true;
      }).pipe(
        Effect.catch(() => Effect.succeed(false)),
        Effect.catchDefect(() => Effect.succeed(false)),
      );

    /** Until the stand-up is settled: fast while the Mate is new, slower after. */
    const wait = Effect.gen(function* () {
      const variables = yield* reads.serviceVariables;
      // A Mate the new press did not make has no stand-up of the server's, and never polls.
      if (variables === undefined || !hasSetupMarker(variables)) return;
      yield* readiness.await;
      const since = yield* Clock.currentTimeMillis;
      while (true) {
        const upMs = (yield* Clock.currentTimeMillis) - since;
        if (yield* tick(upMs)) return;
        yield* Effect.sleep(standUpPollDelay(upMs, timings));
      }
    });

    if (environment !== undefined && isZeropsEnvironment(config)) {
      yield* Effect.forkScoped(wait);
    }

    return ZeropsSetup.of({ document, status });
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
      return hq.mate.standupRequestedBy === null ? { reason: "awaiting_request" } : undefined;
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
 * The live reads: who asked for the stand-up, from the link to HQ; who signed
 * each login in, as this server saw it; the zcp service's variables from the
 * platform's live env store (`/etc/zerops-zembed/env.json`, rewritten seconds
 * after a change, no restart) and this process's own environment; zcp's
 * status file from where `ZCP_STATUS_FILE` names it.
 */
export const liveReadsLayer = Layer.effect(
  ZeropsSetupReads,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const link = yield* ZeropsHqLink;
    const projectSigners = yield* ZeropsProjectSigners;
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
    });
  }),
);

export const layer = Layer.effect(ZeropsSetup, makeZeropsSetup());
