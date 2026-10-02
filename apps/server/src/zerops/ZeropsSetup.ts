/**
 * ZeropsSetup — a new Mate finishes its own setup, with no browser open.
 *
 * Two jobs, both from facts this container holds:
 *
 * - **It reports the setup** (`GET /setup.json`, `zeropsSetupSteps.ts`): the
 *   container is up; the broker's Git variables have reached the zcp service
 *   (the platform's live env store, rewritten seconds after a change); zcp's
 *   status file (`ZCP_STATUS_FILE`) for the runtimes; the project's tags for
 *   the sign-in; the durable record for the stand-up.
 * - **It starts the stand-up**: once the project carries `mate:standup:<userId>`
 *   and that person's signer tag (`mate:signer:{agent}:{userId}`), it sends the
 *   browser's own ask into the Mate's main conversation, admitted as that
 *   person's session exactly as their send would be (D6). Once: the record
 *   lives in the server's database, so a restart repeats nothing, and a
 *   browser's stand-up — an older cached client still sends one — is let
 *   through only while there is none, and recorded too (`browserStandUp`).
 *
 * The Mate's key reads the tags; it cannot write them, so the stand-up tag
 * stays and the record is what says it ran.
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
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { isZeropsEnvironment, type ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import { parseSignerTags, readProjectTagList } from "./ZeropsProjectSigners.ts";
import { hasSetupMarker, readServiceVariableKeys } from "./zeropsSetupMarker.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";
import {
  STAND_UP_MESSAGE,
  hasGitVariables,
  parseZcpStatus,
  setupDocument,
  standUpCommandIds,
  standUpDecision,
  standUpRequestedBy,
  standUpSigners,
  type SetupDocument,
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
 * Tags with no `mate:standup:` tag settle the stand-up as `none` only after
 * this long up: the press writes the tag after it imports zcp, never later.
 */
export const STAND_UP_NONE_AFTER = Duration.minutes(5);

/**
 * How long one read of the project's tags serves: the setup document is public, so
 * however often it is fetched, the platform is asked at most this often.
 */
export const SETUP_TAGS_TTL = Duration.seconds(15);

/**
 * How long a browser's send may stand claimed: one its server lost track of
 * (a restart mid-send) is then the server's to send, under the same ids, so
 * the engine takes it once whichever got through.
 */
export const STAND_UP_CLAIM_MAX_AGE = Duration.minutes(2);

/** How long a failed read of the tags stands before another is tried. */
export const SETUP_TAGS_FAILED_TTL = Duration.seconds(30);

/** The reads this needs from outside the process; a test hands in its own. */
export class ZeropsSetupReads extends Context.Service<
  ZeropsSetupReads,
  {
    /** The project's tags, as the Mate; `undefined` when they cannot be read. */
    readonly tags: Effect.Effect<ReadonlyArray<string> | undefined>;
    /** The zcp service's variables as they stand now; `undefined` when unknown. */
    readonly serviceVariables: Effect.Effect<ReadonlyArray<string> | undefined>;
    /** zcp's status file, parsed as JSON; `undefined` when absent or unreadable. */
    readonly statusFile: Effect.Effect<unknown>;
  }
>()("t3/zerops/ZeropsSetup/ZeropsSetupReads") {}

/**
 * What a browser's stand-up comes to (`browserStandUp`): `claimed`, the
 * Mate's stand-up is this send's until it ends (`browserStandUpEnded`);
 * `dispatch`, it goes through owning nothing; `ignore`, another runs or ran.
 */
export type BrowserStandUp = "claimed" | "dispatch" | "ignore";

/** How a browser's claimed send ended (`browserStandUpEnded`). */
export type BrowserStandUpOutcome = "through" | "failed" | "unknown";

export class ZeropsSetup extends Context.Service<
  ZeropsSetup,
  {
    /** `GET /setup.json`'s document. */
    readonly document: Effect.Effect<SetupDocument>;
    /** zcp's status file, as this build reads it. */
    readonly status: Effect.Effect<ZcpStatus | undefined>;
    /**
     * A browser's stand-up: `claimed` when there is none yet (it is recorded
     * as this one, on its way); `dispatch` when it is the very command already
     * recorded (the engine takes a command id once) or none ran; `ignore`
     * while another runs or ran.
     */
    readonly browserStandUp: (
      command: OrchestrationCommand,
      /** The Zerops user whose session sends it, when it is one. */
      userId?: string,
    ) => Effect.Effect<BrowserStandUp>;
    /**
     * How a `claimed` send ended: `through`, its record stands; `failed`, it
     * surely did not go out, and its own claim, only that, is withdrawn;
     * `unknown` (interrupted, a defect: it may have gone out), the claim
     * stands until {@link STAND_UP_CLAIM_MAX_AGE}, when the server sends it
     * under the same ids.
     */
    readonly browserStandUpEnded: (
      command: OrchestrationCommand,
      outcome: BrowserStandUpOutcome,
    ) => Effect.Effect<void>;
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
 * The Mate's main conversation, by the client's rule (`primaryConversation.ts`):
 * pinned, else spoken in most recently, else the newest; never archived, never
 * a crewmate's.
 */
export const mainConversation = (
  threads: ReadonlyArray<OrchestrationThreadShell>,
): OrchestrationThreadShell | undefined => {
  const time = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0);
  return threads
    .filter((thread) => thread.archivedAt === null && thread.crew === undefined)
    .toSorted((left, right) => {
      const pinned = Number(right.pinnedAt != null) - Number(left.pinnedAt != null);
      if (pinned !== 0) return pinned;
      const spoken =
        Number(time(right.latestUserMessageAt) > 0) - Number(time(left.latestUserMessageAt) > 0);
      if (spoken !== 0) return spoken;
      return (
        time(right.latestUserMessageAt) - time(left.latestUserMessageAt) ||
        time(right.updatedAt) - time(left.updatedAt) ||
        time(right.createdAt) - time(left.createdAt) ||
        left.id.localeCompare(right.id)
      );
    })[0];
};

export interface ZeropsSetupTimings {
  readonly poll: Duration.Duration;
  readonly fastFor: Duration.Duration;
  readonly slowPoll: Duration.Duration;
  readonly noneAfter: Duration.Duration;
  readonly tagsTtl: Duration.Duration;
  readonly tagsFailedTtl: Duration.Duration;
  readonly claimMaxAge: Duration.Duration;
}

const TIMINGS: ZeropsSetupTimings = {
  poll: STAND_UP_POLL,
  fastFor: STAND_UP_FAST_FOR,
  slowPoll: STAND_UP_SLOW_POLL,
  noneAfter: STAND_UP_NONE_AFTER,
  tagsTtl: SETUP_TAGS_TTL,
  tagsFailedTtl: SETUP_TAGS_FAILED_TTL,
  claimMaxAge: STAND_UP_CLAIM_MAX_AGE,
};

/** How long to wait before the next look, this far (ms) into the wait for the stand-up. */
export const standUpPollDelay = (
  elapsedMs: number,
  timings: Pick<ZeropsSetupTimings, "poll" | "fastFor" | "slowPoll"> = TIMINGS,
): Duration.Duration =>
  elapsedMs < Duration.toMillis(timings.fastFor) ? timings.poll : timings.slowPoll;

/** A record's source: a stand-up that ran (here or from a browser), or one settled as never due. */
/**
 * A record's source. `server:claimed`, `browser:claimed`: a send on its way,
 * the first resumed after a restart (its ids make it go out once), the second
 * withdrawn unless it went through. `server`, `browser`: it went out. `none`
 * (nobody asked), `skipped` (the conversation was under way): settled without one.
 */
const RAN: ReadonlySet<string> = new Set([
  "server",
  "browser",
  "server:claimed",
  "browser:claimed",
]);
/** The sources after which nothing is left to do. */
const TERMINAL: ReadonlySet<string> = new Set(["server", "browser", "none", "skipped"]);

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
    /** The last read of the tags, and the last that succeeded. */
    const tagsRead = yield* Ref.make<{
      readonly at: number;
      readonly failed: boolean;
      readonly tags: ReadonlyArray<string> | undefined;
    } | null>(null);
    const reading = yield* Semaphore.make(1);
    const inFlight = yield* Ref.make<Deferred.Deferred<ReadonlyArray<string> | undefined> | null>(
      null,
    );
    const scope = yield* Effect.scope;
    /** Whether the stand-up loop runs: it takes over a claim whose send never ended. */
    const looping = yield* Ref.make(false);

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

    /** Withdraws a claim on its way, `source` naming whose: never any other record. */
    const withdraw = (commandId: string, source: "server:claimed" | "browser:claimed") =>
      sql`DELETE FROM zerops_stand_ups
        WHERE project_id = ${projectId} AND command_id = ${commandId} AND source = ${source}`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    /** A browser's claim its send never ended becomes the server's to send. */
    const takeOver = (commandId: string) =>
      sql`UPDATE zerops_stand_ups SET source = 'server:claimed'
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'browser:claimed'
        RETURNING project_id`.pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.catch(() => Effect.succeed(false)),
      );

    /** A claim taken over that nobody can be sent as: settled, as nobody asked. */
    const settleTaken = (commandId: string) =>
      sql`UPDATE zerops_stand_ups SET source = 'none'
        WHERE project_id = ${projectId} AND command_id = ${commandId}
          AND source = 'server:claimed'`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    /** A claim on its way went out: its record stands for good. */
    const confirm = (commandId: string, from: "server:claimed" | "browser:claimed") =>
      sql`UPDATE zerops_stand_ups SET source = ${from === "server:claimed" ? "server" : "browser"}
        WHERE project_id = ${projectId} AND command_id = ${commandId} AND source = ${from}`.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      );

    /* ---------------------------------------------------------- the facts */

    /**
     * The tags, one read at a time, at most once per {@link SETUP_TAGS_TTL} —
     * once per {@link SETUP_TAGS_FAILED_TTL} after a failure, which answers
     * with the last good read. However often `/setup.json` is asked, the
     * Mate's key reads the platform at most this often.
     */
    const tags = Effect.gen(function* () {
      const next = yield* Effect.uninterruptible(
        reading.withPermits(1)(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const held = yield* Ref.get(tagsRead);
            const ttl = held?.failed === true ? timings.tagsFailedTtl : timings.tagsTtl;
            if (held !== null && now - held.at < Duration.toMillis(ttl)) {
              return { held: held.tags } as const;
            }
            const running = yield* Ref.get(inFlight);
            if (running !== null) return { awaiting: running } as const;
            // Detached from whoever asked: it finishes and stamps the cache even when
            // they give up, so a request that aborts never costs another read.
            const done = yield* Deferred.make<ReadonlyArray<string> | undefined>();
            yield* Ref.set(inFlight, done);
            yield* Effect.forkIn(
              Effect.gen(function* () {
                const read = yield* reads.tags.pipe(
                  Effect.catchCause(() => Effect.succeed(undefined)),
                );
                const at = yield* Clock.currentTimeMillis;
                yield* Ref.set(
                  tagsRead,
                  read === undefined
                    ? { at, failed: true, tags: held?.tags }
                    : { at, failed: false, tags: read },
                );
                yield* Ref.set(inFlight, null);
                yield* Deferred.succeed(done, read ?? held?.tags);
              }),
              scope,
            );
            return { awaiting: done } as const;
          }),
        ),
      );
      return "held" in next ? next.held : yield* Deferred.await(next.awaiting);
    });

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
      const git = yield* latch(gitAt, variables !== undefined && hasGitVariables(variables));
      const marked = variables !== undefined && hasSetupMarker(variables);
      const record = yield* recordOf;
      const ran = record !== undefined && RAN.has(record.source);
      const signedInAt = yield* Ref.get(signinAt);
      // Only a marked Mate reads the tags, and only for what its record cannot say: a stand-up
      // still pending, or — settled as never due — a sign-in not seen yet. A Mate made before
      // has its browser's stand-up, and one that ran has its sign-in in its record.
      const tagList =
        marked && (record === undefined || (!ran && signedInAt === undefined))
          ? yield* tags
          : undefined;
      const requestedBy = tagList === undefined ? undefined : standUpRequestedBy(tagList);
      const signedIn =
        ran ||
        (tagList !== undefined &&
          (requestedBy === undefined
            ? Object.keys(parseSignerTags(tagList)).length > 0
            : standUpSigners(tagList, requestedBy).length > 0));
      // The sign-in is known from a stand-up that ran, from the tags read, or once seen: a step
      // once done stays done.
      const signinKnown = ran || marked || signedInAt !== undefined;
      return setupDocument({
        now: yield* nowIso,
        startedAt,
        gitAt: git,
        status: yield* status,
        tagsRead: tagList !== undefined,
        requestedBy,
        signinAt: yield* latch(signinAt, signedIn),
        record: record === undefined ? undefined : { startedAt: record.startedAt, ran },
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
        // A browser's send is on its way: it ends in a record, or leaves the stand-up to
        // us — and one that never ends is ours after a while, under its own ids.
        if (held?.source === "browser:claimed") {
          const age = (yield* Clock.currentTimeMillis) - Date.parse(held.startedAt);
          if (!(age >= Duration.toMillis(timings.claimMaxAge))) return false;
          if (!(yield* takeOver(held.commandId))) return false;
        }
        const resuming =
          held?.source === "server:claimed" || held?.source === "browser:claimed"
            ? held
            : undefined;
        const tagList = yield* tags;
        if (tagList === undefined) return false;
        // A claim taken over is sent as whoever can send it now: its sender, else the person
        // who asked for the stand-up — the first of them who holds an agent here. When none
        // does, it went out (its message is in the conversation) or it is settled as none:
        // a claim never waits on a sign-in that may never come.
        const requestedBy =
          resuming === undefined
            ? standUpRequestedBy(tagList)
            : [resuming.userId, standUpRequestedBy(tagList)].find(
                (userId): userId is string =>
                  userId !== undefined &&
                  userId !== "" &&
                  standUpSigners(tagList, userId).length > 0,
              );
        if (requestedBy === undefined && resuming !== undefined) {
          const thread = Option.getOrUndefined(
            yield* projection
              .getThreadShellById(ThreadId.make(resuming.threadId))
              .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
          );
          if (thread?.latestUserMessageAt != null) {
            yield* confirm(resuming.commandId, "server:claimed");
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
            ? mainConversation(threads)
            : threads.find((thread) => thread.id === resuming.threadId);
        // Resumed, and its stand-up is already in the conversation: it went out before.
        if (resuming !== undefined && main?.latestUserMessageAt != null) {
          yield* confirm(resuming.commandId, "server:claimed");
          return true;
        }
        const decision = standUpDecision({
          recorded: false,
          requestedBy,
          signers: standUpSigners(tagList, requestedBy),
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
              Effect.andThen(withdraw(ids.commandId, "server:claimed")),
              Effect.as(false),
            ),
          ),
        );
        if (!sent) return false;
        yield* confirm(ids.commandId, "server:claimed");
        yield* Effect.logInfo("zerops setup: the stand-up went out", { threadId });
        return true;
      }).pipe(
        Effect.catch(() => Effect.succeed(false)),
        Effect.catchDefect(() => Effect.succeed(false)),
      );

    /** Until the stand-up is settled: fast while the Mate is new, slower after. */
    const wait = Effect.gen(function* () {
      const variables = yield* reads.serviceVariables;
      // A Mate the new press did not make keeps its browser's stand-up, and never polls.
      if (variables === undefined || !hasSetupMarker(variables)) return;
      yield* Ref.set(looping, true);
      yield* readiness.await;
      const since = yield* Clock.currentTimeMillis;
      while (true) {
        const upMs = (yield* Clock.currentTimeMillis) - since;
        if (yield* tick(upMs)) return;
        yield* Effect.sleep(standUpPollDelay(upMs, timings));
      }
    });

    if (environment !== undefined && isZeropsEnvironment(config)) {
      yield* Effect.forkScoped(wait.pipe(Effect.ensuring(Ref.set(looping, false))));
    }

    const browserStandUp = (command: OrchestrationCommand, userId?: string) =>
      Effect.gen(function* () {
        if (command.type !== "thread.turn.start") return "dispatch" as const;
        // Where the server never stands up, a browser's stand-up passes as it always did.
        const variables = yield* reads.serviceVariables;
        if (variables === undefined || !hasSetupMarker(variables)) return "dispatch" as const;
        let held = yield* recordOf;
        // A claim whose send never ended, with no loop to take it over: withdrawn after a while.
        if (
          held?.source === "browser:claimed" &&
          !(yield* Ref.get(looping)) &&
          (yield* Clock.currentTimeMillis) - Date.parse(held.startedAt) >=
            Duration.toMillis(timings.claimMaxAge)
        ) {
          yield* withdraw(held.commandId, "browser:claimed");
          held = undefined;
        }
        // Settled without one (`none`, `skipped`): nothing ran, so a browser's is the only one.
        if (held !== undefined && !RAN.has(held.source)) return "dispatch" as const;
        if (held !== undefined) return held.commandId === command.commandId ? "dispatch" : "ignore";
        const claimed = yield* claim({
          threadId: command.threadId,
          commandId: command.commandId,
          userId: userId ?? "",
          source: "browser:claimed",
          startedAt: yield* nowIso,
        });
        return claimed ? ("claimed" as const) : ("ignore" as const);
      });

    return ZeropsSetup.of({
      document,
      status,
      browserStandUp,
      browserStandUpEnded: (command, outcome) =>
        outcome === "through"
          ? confirm(command.commandId, "browser:claimed")
          : outcome === "failed"
            ? withdraw(command.commandId, "browser:claimed")
            : Effect.void,
    });
  });

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
 * The live reads: the tags with the Mate's own key; the zcp service's
 * variables from the platform's live env store (`/etc/zerops-zembed/env.json`,
 * rewritten seconds after a change, no restart) and this process's own
 * environment; zcp's status file from where `ZCP_STATUS_FILE` names it.
 */
export const makeLiveReads = (input: {
  readonly environment: ZeropsEnvironment | undefined;
  readonly statusFilePath: string | undefined;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
    const { environment, statusFilePath } = input;
    return ZeropsSetupReads.of({
      tags:
        environment === undefined
          ? Effect.succeed(undefined)
          : readProjectTagList({ environment }).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
            ),
      serviceVariables: readServiceVariableKeys.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
      statusFile:
        statusFilePath === undefined || statusFilePath.length === 0
          ? Effect.succeed(undefined)
          : readFileJson(fs, statusFilePath),
    });
  });

export const liveReadsLayer = Layer.effect(
  ZeropsSetupReads,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return yield* makeLiveReads({
      environment: config.zerops,
      statusFilePath: process.env[ZCP_STATUS_FILE_VARIABLE],
    });
  }),
);

export const layer = Layer.effect(ZeropsSetup, makeZeropsSetup());
