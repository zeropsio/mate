/**
 * Crew mode — the wire between the crew engine and its clients (ARCHITECTURE
 * §6 *RPC shape*, PRD §8).
 *
 * `subscribeZeropsCrew` streams one whole {@link CrewSnapshot} per change; the
 * snapshot is read from the crew tables only, never over ssh, so every field
 * here is something the engine already recorded. Presses travel as one
 * {@link CrewCommand} through `zerops.crew.command`; the crew home's files
 * travel as {@link CrewFiles} through `zerops.crew.files.get`/`put`.
 *
 * Words are not on the wire: a client renders states, reasons and attention
 * rows through `@t3tools/client-runtime/zerops/crew/phrases` (R5), so the
 * engine sends codes and facts — a handle, a path, a count — never a sentence.
 * The closed vocabularies live in `zeropsCrewStates.ts`; the unions declared
 * here are the ones only this wire carries.
 *
 * Client and server ship apart (the hosted client against a pinned Mate), so
 * every field added after the first contract decodes when absent, to the value
 * an older server means by leaving it out; and the feed's frame decodes
 * through {@link CrewFeedFrame}, which never fails.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  PortSchema,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatAttachment } from "./orchestration.ts";
import { ZeropsAgentId } from "./zerops.ts";
import {
  CrewAppState,
  CrewApplyChoice,
  CrewAttentionKind,
  CREW_HANDLE_PATTERN,
  CrewClaimState,
  CrewHandle,
  CrewLandingMode,
  CrewMemberKind,
  CrewRunState,
  CREW_SESSION_REASONS,
  CrewStatus,
  CrewStintState,
  CrewTaskSource,
  CrewTaskState,
} from "./zeropsCrewStates.ts";

/** A task's stable id (`crew_assignment.assignment`); the person sees `#number`. */
export const CrewTaskId = TrimmedNonEmptyString;
export type CrewTaskId = typeof CrewTaskId.Type;

export const CrewRunId = TrimmedNonEmptyString;
export type CrewRunId = typeof CrewRunId.Type;

/**
 * A crewmate's face colour: one of the Mate tints (`MATE_TINTS` in
 * `@t3tools/shared/brand`, which contracts cannot import). A client-runtime
 * test pins the two lists to each other.
 */
export const CrewTint = Schema.Literals([
  "coral",
  "amber",
  "olive",
  "sky",
  "violet",
  "rose",
  "sand",
  "slate",
]);
export type CrewTint = typeof CrewTint.Type;

/** The brief's and the job's versions, which together make a crewmate's system prompt (PRD §5.6). */
export const CrewPromptVersion = Schema.Struct({
  brief: PositiveInt,
  job: PositiveInt,
});
export type CrewPromptVersion = typeof CrewPromptVersion.Type;

/** A coding agent signed in to one account in this project (PRD §2.3 *Runs on*). */
export const CrewLogin = Schema.Struct({
  /** The provider instance id. */
  id: TrimmedNonEmptyString,
  /** What *Runs on* names it: a Mate login's label, e.g. "work", else its agent's name. */
  label: Schema.String,
  /** Absent for an agent Mate signs nobody in to (Cursor, OpenCode, Grok, Antigravity). */
  agent: Schema.optional(ZeropsAgentId),
});
export type CrewLogin = typeof CrewLogin.Type;

/** One conversation of a standing crewmate; a rotation retires it and opens the next. */
export const CrewStint = Schema.Struct({
  stint: PositiveInt,
  threadId: ThreadId,
  state: CrewStintState,
  /** Why this stint was opened (a rotation's reason, *Start fresh*); `null` for the first. */
  reason: Schema.NullOr(Schema.String),
  /** The summary of this stint's last compaction, for the compaction row's expansion. */
  lastCompactSummary: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});
export type CrewStint = typeof CrewStint.Type;

/** Why a session opened, as the snapshot says it. */
export const CrewSessionReason = Schema.Literals([...CREW_SESSION_REASONS, "unknown"]);
export type CrewSessionReason = typeof CrewSessionReason.Type;

const knownSessionReasons = new Set<string>(CREW_SESSION_REASONS);
const LastSessionReason = Schema.NullOr(CrewSessionReason);

/** An engine crewmate's sessions in its one conversation: how many, and why the last one opened. */
export const CrewSessions = Schema.Struct({
  count: NonNegativeInt,
  /**
   * `null` while its first session is its only one. A reason from a newer server decodes as
   * `unknown` rather than leaving the crew undrawn: read from the raw value, since a field
   * default checks the encoded side first.
   */
  lastReason: Schema.Unknown.pipe(
    Schema.decodeTo(
      LastSessionReason,
      SchemaTransformation.transform<typeof LastSessionReason.Encoded, unknown>({
        decode: (raw) =>
          raw === null
            ? null
            : typeof raw === "string" && knownSessionReasons.has(raw)
              ? (raw as CrewSessionReason)
              : "unknown",
        encode: (reason) => reason,
      }),
    ),
  ),
});
export type CrewSessions = typeof CrewSessions.Type;

export const CrewCheckState = Schema.Literals(["running", "passed", "failed"]);
export type CrewCheckState = typeof CrewCheckState.Type;

/** A run of the crewmate's *Check command* in its copy. */
export const CrewCheck = Schema.Struct({
  state: CrewCheckState,
  /** The tail of the command's output, as the task sheet shows it; empty while running. */
  output: Schema.String,
});
export type CrewCheck = typeof CrewCheck.Type;

/**
 * A writer's copy of the code (its lane). `creating` and `setting-up` are
 * Apply's per-crewmate progress (PRD §4.7); `conflicts` is a merge-in stopped
 * on unmerged paths; `frozen` is its dev service redeploying (landings, WIP and
 * setup wait); `missing` is a copy whose directory is gone until recovery puts
 * it back; `failed` is a copy Apply or recovery could not make.
 */
export const CrewLaneState = Schema.Literals([
  "creating",
  "setting-up",
  "ready",
  "conflicts",
  "frozen",
  "missing",
  "failed",
]);
export type CrewLaneState = typeof CrewLaneState.Type;

export const CrewLaneSummary = Schema.Struct({
  /** `crew/<handle>`. */
  branch: TrimmedNonEmptyString,
  /** Commits ahead of your tree. */
  ahead: NonNegativeInt,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  /** Changes in the copy no commit holds yet, as last read; *Land now* commits them first. */
  dirty: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** The copy's latest check; `null` before its first. */
  check: Schema.NullOr(CrewCheck),
  state: CrewLaneState,
  /** The setup command while `setting-up`; the reason while `failed`; otherwise `null`. */
  detail: Schema.NullOr(Schema.String),
});
export type CrewLaneSummary = typeof CrewLaneSummary.Type;

/** At most this many crew ports per dev service (PRD §5.7 *Add crew ports*). */
export const CREW_PORTS_MAX = 10;

/**
 * The crewmate's own app on its crew port (PRD §5.7). `port` is `null` when its
 * service has more crewmates than crew ports; `url` is the port's public
 * subdomain URL, `null` until the port is routed.
 */
export const CrewApp = Schema.Struct({
  state: CrewAppState,
  port: Schema.NullOr(PortSchema),
  url: Schema.NullOr(Schema.String),
});
export type CrewApp = typeof CrewApp.Type;

export const Crewmate = Schema.Struct({
  handle: CrewHandle,
  displayName: TrimmedNonEmptyString,
  tint: CrewTint,
  kind: CrewMemberKind,
  /** The job's first line, for the row and the chat header. */
  jobFirstLine: Schema.String,
  /** Always `promptVersions.current.job`, for the header's `Job v4` chip. */
  jobVersion: PositiveInt,
  /**
   * `running`: what the current stint's session was started with, `null` before
   * its first turn. `current`: what the crew home holds now. A crewmate whose
   * `running` is older than `current` is pending ("v5 at next turn").
   */
  promptVersions: Schema.Struct({
    running: Schema.NullOr(CrewPromptVersion),
    current: CrewPromptVersion,
  }),
  login: CrewLogin,
  /** `null`: the login's default model. */
  model: Schema.NullOr(TrimmedNonEmptyString),
  /** `null`: the login's default effort. */
  effort: Schema.NullOr(TrimmedNonEmptyString),
  /** Always `kind !== "writer"`. */
  readOnly: Schema.Boolean,
  /** The dev service its copy lives on; `null` for a read-only crewmate. */
  host: Schema.NullOr(TrimmedNonEmptyString),
  /** The current stint's thread; `null` before the crewmate's first turn. */
  currentThreadId: Schema.NullOr(ThreadId),
  /** Every stint, oldest first — *Previous conversations*. Empty on the engine. */
  stints: Schema.Array(CrewStint),
  /**
   * The engine conversation the crewmate talks in, which `currentThreadId` repeats; absent on a V1
   * Mate, whose crewmates talk in stints.
   */
  conversationId: Schema.optionalKey(TrimmedNonEmptyString),
  /** Its sessions on the engine, in place of `stints`; absent on a V1 Mate. */
  sessions: Schema.optionalKey(CrewSessions),
  /** The current stint's context against its window; `null` before a turn reports it. */
  context: Schema.NullOr(Schema.Struct({ tokens: NonNegativeInt, window: PositiveInt })),
  /** Compactions in the current stint. */
  compactions: NonNegativeInt,
  memory: Schema.Struct({ entries: NonNegativeInt, unfiled: NonNegativeInt }),
  /** The one task it works on (not queued, landed, parked or discarded). */
  openTaskId: Schema.NullOr(CrewTaskId),
  /** Its queued tasks, oldest first — the order they start in. */
  queuedTaskIds: Schema.Array(CrewTaskId),
  /** `null` exactly when `readOnly`. */
  lane: Schema.NullOr(CrewLaneSummary),
  /** `null` exactly when `readOnly`. */
  app: Schema.NullOr(CrewApp),
});
export type Crewmate = typeof Crewmate.Type;

/**
 * What a dev service's own dev server serves right now, read from the running
 * process rather than assumed (CONCEPT §3.3). `unknown`: not running, or
 * serving neither your tree nor a crewmate's copy.
 */
export const CrewServed = Schema.Union([
  Schema.Struct({ by: Schema.Literal("tree") }),
  Schema.Struct({ by: Schema.Literal("crewmate"), handle: CrewHandle }),
  Schema.Struct({ by: Schema.Literal("unknown") }),
]);
export type CrewServed = typeof CrewServed.Type;

export const CrewHost = Schema.Struct({
  host: TrimmedNonEmptyString,
  /**
   * Your tree on the service: its branch (`null` when detached) and HEAD, as
   * the engine last read them — *Changes* diffs `<head>..crew/<handle>`.
   * `null` before the engine has read them.
   */
  integration: Schema.NullOr(
    Schema.Struct({
      branch: Schema.NullOr(TrimmedNonEmptyString),
      head: TrimmedNonEmptyString,
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /**
   * Declared once per dev service (PRD §5.7); empty until *Add crew ports* is
   * done. `routed` is whether the subdomain routes the port; `null` when the
   * engine cannot know (not confirmed).
   */
  crewPorts: Schema.Array(
    Schema.Struct({
      port: PortSchema,
      routed: Schema.NullOr(Schema.Boolean).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
    }),
  ),
  served: CrewServed,
  /** The Show-on-dev claim; `handle` is its holder or requester, `null` in `none`. */
  claim: Schema.Struct({
    state: CrewClaimState,
    handle: Schema.NullOr(CrewHandle),
    /** *Allow* was pressed while the crewmate's turn ran; the claim turn goes out at its end. */
    grantWaiting: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  }),
});
export type CrewHost = typeof CrewHost.Type;

export const CrewReviewVerdict = Schema.Literals(["accept", "reject"]);
export type CrewReviewVerdict = typeof CrewReviewVerdict.Type;

export const CrewReview = Schema.Struct({
  verdict: CrewReviewVerdict,
  note: Schema.String,
  /** The reviewing crewmate; `null` when you reviewed it. */
  by: Schema.NullOr(CrewHandle),
});
export type CrewReview = typeof CrewReview.Type;

/** A task on the board (PRD §6.1). */
export const CrewTask = Schema.Struct({
  id: CrewTaskId,
  /** `#N`, per crew, increasing. */
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  owner: CrewHandle,
  state: CrewTaskState,
  source: CrewTaskSource,
  /** The Zerops user whose press or message created it; `null` for a task the lead started without asking. */
  createdBy: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  dependsOn: Schema.Array(CrewTaskId),
  /** Marked as unrelated work: its dispatch starts a fresh conversation. */
  fresh: Schema.Boolean,
  /** The objective. */
  brief: Schema.String,
  /** Empty when none was given. */
  doneWhen: Schema.String,
  /**
   * What the task's card says beside its brief — for one task of a fan-out,
   * who else the message went to and which part is this crewmate's (PRD §5.3);
   * `null` when the card says nothing more.
   */
  note: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  attempts: NonNegativeInt,
  /** Why it went to `rework` or `parked`. */
  reason: Schema.NullOr(Schema.String),
  /** The crewmate's question while `blocked`. */
  question: Schema.NullOr(Schema.String),
  /** Paths edited in your tree that its landing waits on (`waiting-on-you`). */
  waitingOn: Schema.Array(Schema.String),
  /** Its change against your tree; `null` before the first commit. */
  diffStat: Schema.NullOr(Schema.Struct({ insertions: NonNegativeInt, deletions: NonNegativeInt })),
  /** The crewmate's last report. */
  report: Schema.NullOr(Schema.String),
  check: Schema.NullOr(CrewCheck),
  review: Schema.NullOr(CrewReview),
  /** The landing commit in your tree. */
  landedCommit: Schema.NullOr(TrimmedNonEmptyString),
  /**
   * When it went into your tree — the Crew tab dates its row in "In Fen's
   * code" by it; `null` before, and from an older server, which says nothing.
   */
  landedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** A landed task whose change has gone out with *Deliver*. */
  delivered: Schema.Boolean,
});
export type CrewTask = typeof CrewTask.Type;

/** A budget in dollars or a time limit in hours — each may be "No limit" (PRD Δ16). */
const CrewLimit = Schema.Union([
  Schema.Number.check(Schema.isGreaterThan(0)),
  Schema.Literal("unlimited"),
]);

/** "Stop at 80 % of the usage window"; `null` when the option is off. */
const CrewUsageStop = Schema.NullOr(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
);

/** The run dialog's choices (PRD §4.8); `start` carries exactly these. */
export const CrewRunOptions = Schema.Struct({
  budgetUsd: CrewLimit,
  timeLimitHours: CrewLimit,
  /** "Stop at 80 % of the usage window"; `null` when the option is off. */
  stopAtUsagePercent: CrewUsageStop,
  landing: CrewLandingMode,
  /** "The crew may show work on dev" (otherwise the person grants each claim). */
  devGrant: Schema.Boolean,
  /** "The lead may start tasks without asking". */
  leadMayStart: Schema.Boolean,
});
export type CrewRunOptions = typeof CrewRunOptions.Type;

/** Why a run is paused or over: your press, one of its limits, or a refused dispatch. */
export const CrewRunReason = Schema.Literals(["person", "budget", "time", "usage", "refused"]);
export type CrewRunReason = typeof CrewRunReason.Type;

/** The crew's latest run in any state; the run dialog takes its defaults from it. */
export const CrewRun = Schema.Struct({
  id: CrewRunId,
  state: CrewRunState,
  reason: Schema.NullOr(CrewRunReason),
  /** The refusal's own words for `refused`; otherwise `null`. */
  reasonDetail: Schema.NullOr(Schema.String),
  /** The Zerops user who pressed Start. */
  startedBy: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  /**
   * The time the crew has worked in the run — running with a crew turn
   * running — which its time limit counts; paused time and time the crew sat
   * idle are left out. An older server counts wall time running, idle time
   * included; a client reads either the same way.
   */
  elapsedMs: NonNegativeInt,
  spentUsd: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The usage window's current use; `null` when the login reports none. */
  usagePercent: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  options: CrewRunOptions,
});
export type CrewRun = typeof CrewRun.Type;

/** One owned attempt. A restart ends running attempts and the engine carries each on from its recorded stage; a person continues only an ambiguous one. */
export const CrewOperation = Schema.Struct({
  id: Schema.String,
  crew: Schema.String,
  handle: CrewHandle,
  taskId: Schema.NullOr(CrewTaskId),
  kind: Schema.Literals(["dispatch", "checkpoint", "check", "landing", "rebuild"]),
  stage: Schema.String,
  confirmedStage: Schema.String,
  status: Schema.Literals([
    "running",
    "succeeded",
    "failed",
    "interrupted",
    "continued",
    "discarded",
  ]),
  startedBy: Schema.String,
  resumeState: CrewTaskState,
  targets: Schema.Struct({
    host: Schema.NullOr(Schema.String),
    path: Schema.NullOr(Schema.String),
    ref: Schema.NullOr(Schema.String),
    threadId: Schema.NullOr(Schema.String),
    commandId: Schema.NullOr(Schema.String),
    attempt: Schema.Number,
  }),
  result: Schema.Unknown,
  detail: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CrewOperation = typeof CrewOperation.Type;

/** One *Waiting on you* row (PRD §4.3 item 4, §5.5). */
export const CrewAttention = Schema.Struct({
  /** Stable across snapshots while the row stands. */
  id: TrimmedNonEmptyString,
  kind: CrewAttentionKind,
  operation: Schema.optional(CrewOperation),
  copyAssignment: Schema.optional(
    Schema.Struct({
      threadId: ThreadId,
      currentPath: Schema.NullOr(Schema.String),
      crewPath: Schema.String,
      source: Schema.Literal("crew-stint"),
    }),
  ),
  /** Whose row it is (the asker, the lander, the lead for a plan). */
  handle: Schema.NullOr(CrewHandle),
  taskId: Schema.NullOr(CrewTaskId),
  /**
   * The question for `question`; the reason for `parked` and `cant-start`; the
   * check's last line for `check-failed`; why its last turn ended for `stalled`;
   * the review's note for `sent-back`.
   */
  text: Schema.NullOr(Schema.String),
  /** Your tree's paths for `landing-wait`; the conflicting paths for `conflict`. */
  paths: Schema.Array(Schema.String),
  /** The dev service for `show-on-dev`. */
  host: Schema.NullOr(TrimmedNonEmptyString),
  /**
   * Since when the row stands; for `stalled`, when the task's last turn ended;
   * for `review-wait`, when the task went into review.
   */
  at: IsoDateTime,
});
export type CrewAttention = typeof CrewAttention.Type;

/** The crew as a whole, for the section's header and brief row. */
export const CrewSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  briefTitle: Schema.String,
  briefVersion: PositiveInt,
  /** The brief's first two lines. */
  briefExcerpt: Schema.String,
});
export type CrewSummary = typeof CrewSummary.Type;

/**
 * A seam line in a crewmate's chat that no card carries (PRD §4.5, *Seams*):
 * a thread activity of kind {@link CREW_SEAM_ACTIVITY_KIND} on the
 * conversation the person reads at that moment, its `summary` the line's
 * words. `landed`: a task landed. `closed`: a task was accepted or landed with
 * nothing of its own to land, and closed. `saved`: a saved brief, job or login that
 * reaches this conversation later, by `apply`. `stint`: a conversation opened
 * between turns (*Start fresh*, a save applied at once) opens with its
 * reason; one opened for a turn carries the reason in that turn's card.
 * `swept`: work a restart left uncommitted in the crewmate's copy, saved by
 * the boot sweep as a WIP commit on its branch — the files and the commit.
 */
export const CREW_SEAM_ACTIVITY_KIND = "crew.seam";

export const CrewSeam = Schema.Union([
  Schema.Struct({
    seam: Schema.Literal("landed"),
    taskId: CrewTaskId,
    number: PositiveInt,
    commit: TrimmedNonEmptyString,
  }),
  Schema.Struct({ seam: Schema.Literal("closed"), taskId: CrewTaskId, number: PositiveInt }),
  Schema.Struct({ seam: Schema.Literal("saved"), apply: CrewApplyChoice }),
  Schema.Struct({ seam: Schema.Literal("stint"), previousThreadId: Schema.NullOr(ThreadId) }),
  Schema.Struct({
    seam: Schema.Literal("swept"),
    branch: TrimmedNonEmptyString,
    commit: TrimmedNonEmptyString,
    paths: Schema.Array(Schema.String),
  }),
]);
export type CrewSeam = typeof CrewSeam.Type;

/**
 * A dev service a writer's copy can live on: one this Mate mounts, with
 * whether its ssh environment reaches a database (a writer there declares
 * `env:` or `database: shared`); `database` is `null` until the engine read it.
 */
export const CrewDevHost = Schema.Struct({
  host: TrimmedNonEmptyString,
  database: Schema.NullOr(Schema.Boolean),
});
export type CrewDevHost = typeof CrewDevHost.Type;

/** Where a crew snapshot stands on the engine, as a conversation's revision does. */
export const CrewRevision = Schema.Struct({ epoch: Schema.Int, seq: NonNegativeInt });
export type CrewRevision = typeof CrewRevision.Type;

/**
 * One frame of the crew feed. `crew` is `null` exactly when `status` is not
 * `applied`; a status other than `applied` carries empty lists, `devHosts`
 * aside: the crewmate editor offers them before any crew exists.
 */
export const CrewSnapshot = Schema.Struct({
  status: CrewStatus,
  /** Rises with every change the engine records; a client keeps the highest. */
  seq: NonNegativeInt,
  /**
   * The crew owner's revision on the engine: the Mate's start epoch and the crew's gapless sequence,
   * which a client compares epoch first. Absent from a V1 Mate, whose `seq` is the only order.
   */
  revision: Schema.optionalKey(CrewRevision),
  crew: Schema.NullOr(CrewSummary),
  /** The lead first, then in the crew home's order. */
  crewmates: Schema.Array(Crewmate),
  /** Every dev service a writer's copy lives on. */
  hosts: Schema.Array(CrewHost),
  board: Schema.Struct({ tasks: Schema.Array(CrewTask) }),
  run: Schema.NullOr(CrewRun),
  attention: Schema.Array(CrewAttention),
  operations: Schema.optional(Schema.Array(CrewOperation)),
  /** Where a writer's copy may live (the crewmate editor's *Service*); empty where crew mode is off. */
  devHosts: Schema.Array(CrewDevHost).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Landed tasks whose change has not gone out with *Deliver* yet. */
  landedNotDelivered: NonNegativeInt,
  /** The engine's last failure the section should show; `null` when none stands. */
  lastError: Schema.NullOr(Schema.String),
});
export type CrewSnapshot = typeof CrewSnapshot.Type;

/** A crew feed frame this build could not decode (see {@link CrewFeedFrame}). */
export const CrewFrameUndecodable = Schema.TaggedStruct("CrewFrameUndecodable", {});
export type CrewFrameUndecodable = typeof CrewFrameUndecodable.Type;

const decodeSnapshotOption = Schema.decodeUnknownOption(CrewSnapshot);

/**
 * The crew feed's wire codec. A frame this build cannot decode — a server
 * newer than the client, or older in a way no default covers — decodes as
 * {@link CrewFrameUndecodable} instead of failing: a stream chunk that fails
 * to decode takes the whole connection down with it (effect's `RpcClient`
 * dies on it), and every other feed of the Mate with it. The client reads an
 * undecodable frame as a Mate whose crew it cannot show. Encoding is the
 * snapshot's own.
 */
export const CrewFeedFrame = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Union([CrewSnapshot, CrewFrameUndecodable]),
    SchemaTransformation.transform<
      typeof CrewSnapshot.Encoded | typeof CrewFrameUndecodable.Encoded,
      unknown
    >({
      decode: (raw) =>
        Option.isSome(decodeSnapshotOption(raw))
          ? (raw as typeof CrewSnapshot.Encoded)
          : { _tag: "CrewFrameUndecodable" },
      encode: (frame) => frame,
    }),
  ),
);
export type CrewFeedFrame = typeof CrewFeedFrame.Type;

/**
 * `crew.taskPage`'s input: a crewmate's finished work older than the board holds, newest first,
 * from `before` (the previous page's `next`; `null` for the first page past the board).
 */
export const CrewTaskPageInput = Schema.Struct({
  handle: CrewHandle,
  before: Schema.NullOr(TrimmedNonEmptyString),
  limit: Schema.optionalKey(PositiveInt),
});
export type CrewTaskPageInput = typeof CrewTaskPageInput.Type;

/** One page of finished work; `next` reads the page after it, `null` at the oldest. */
export const CrewTaskPage = Schema.Struct({
  tasks: ForwardCompatibleArray(CrewTask),
  next: Schema.NullOr(TrimmedNonEmptyString),
});
export type CrewTaskPage = typeof CrewTaskPage.Type;

const taskRef = { taskId: CrewTaskId } as const;
const handleRef = { handle: CrewHandle } as const;
const hostRef = { host: TrimmedNonEmptyString } as const;
const runRef = { runId: CrewRunId } as const;

/**
 * Every press on a crew surface (ARCHITECTURE §6 *CrewCommand tags* plus PRD §8;
 * CONCEPT's `assign` is `taskCreate`). Commands that start a turn run admission
 * with the caller's session as the principal; the engine answers through
 * {@link CrewCommandResult} and the next snapshot, never with a sentence.
 *
 * `briefSave`, `jobSave` and `apply` carry no file content: the editors save
 * through `zerops.crew.files.put`, and these apply what is saved — `apply` the
 * whole crew home (setup, a new crewmate), `briefSave` the brief, `jobSave` one
 * crewmate's job and *Runs on*. A changed login applies only with `fresh`
 * (PRD §2.3).
 */
export const CrewCommand = Schema.TaggedUnion({
  apply: {},
  rebuildCopy: { ...handleRef },
  /** Thaws a host whose redeploy could not be read: the person says it ended. */
  thawHost: { host: Schema.String },
  operationContinue: { ...handleRef, operationId: Schema.String },
  operationDiscard: { ...handleRef, operationId: Schema.String },
  useCrewCopy: { ...handleRef, threadId: ThreadId, expectedPath: Schema.NullOr(Schema.String) },
  start: CrewRunOptions.fields,
  pause: runRef,
  /**
   * Resumes a paused run. A limit given replaces the run's (a budget above
   * what it has spent, or *No limit*); an absent one keeps the run's current
   * value.
   */
  resume: {
    ...runRef,
    budgetUsd: Schema.optional(CrewLimit),
    timeLimitHours: Schema.optional(CrewLimit),
    stopAtUsagePercent: Schema.optional(CrewUsageStop),
  },
  stop: runRef,
  finish: runRef,
  /** A crewmate chat's send (PRD §5.2a): steers the open task, or opens an implicit one. */
  message: {
    ...handleRef,
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  },
  /** *Tell the crew*: routed by its mentions (PRD §5.3). */
  tell: {
    text: TrimmedNonEmptyString,
    /** The composer's crewmate mention nodes, in the order typed. */
    mentions: Schema.Array(Schema.Struct(handleRef)),
  },
  taskCreate: {
    owner: CrewHandle,
    title: TrimmedNonEmptyString,
    brief: Schema.String,
    doneWhen: Schema.String,
    dependsOn: Schema.Array(CrewTaskId),
  },
  /**
   * Only the fields present change; a queued task whose dependencies change
   * starts at once when its crewmate is free (*Drop the wait*).
   */
  taskEdit: {
    ...taskRef,
    title: Schema.optional(TrimmedNonEmptyString),
    brief: Schema.optional(Schema.String),
    doneWhen: Schema.optional(Schema.String),
    dependsOn: Schema.optional(Schema.Array(CrewTaskId)),
  },
  /** Discards one task, from any state (ARCHITECTURE §4 *Assignment*). */
  discard: taskRef,
  /** Marks a task as unrelated work: its dispatch starts a fresh conversation. */
  markFresh: taskRef,
  /**
   * *Try again*: a stopped task (`parked`) queues again and starts when its
   * crewmate is free; a queued one admission refused tries again now.
   */
  taskRetry: taskRef,
  /** Accepts rows of the lead's plan: `proposed` → `queued`. */
  planAccept: { taskIds: Schema.NonEmptyArray(CrewTaskId) },
  planDiscard: { taskIds: Schema.NonEmptyArray(CrewTaskId) },
  /** Your review of a task in `review`. */
  review: { ...taskRef, verdict: CrewReviewVerdict, note: Schema.String },
  /** *Land* on a `ready` task; on one in `review`, your accept first (*Land it myself*). */
  land: taskRef,
  /** *Land* on a task whose crewmate never reported: WIP commit, merge-in, check, land. */
  landNow: taskRef,
  /** *Ask to resolve* a merge-in conflict: one turn as you. */
  askResolve: taskRef,
  /** *Ask to fix* a failed check: one turn as you. */
  askFix: taskRef,
  /** Answers a crewmate's question; `taskId` is `null` for the lead's own question. */
  answer: { ...handleRef, taskId: Schema.NullOr(CrewTaskId), text: TrimmedNonEmptyString },
  claimGrant: hostRef,
  claimDeny: hostRef,
  /** *Back to my tree*. */
  claimRelease: hostRef,
  /** *Show on dev* pressed by you: the crewmate's request and your grant at once. */
  showOnDev: handleRef,
  startFresh: handleRef,
  briefSave: { apply: CrewApplyChoice },
  jobSave: { ...handleRef, apply: CrewApplyChoice },
  memoryEdit: { ...handleRef, entryId: TrimmedNonEmptyString, text: TrimmedNonEmptyString },
  memoryRemove: { ...handleRef, entryId: TrimmedNonEmptyString },
  forgetMemory: handleRef,
  /**
   * *Remove from crew*. A copy with unlanded commits is kept and the removal
   * refused (`unlanded-commits`) unless `discardUnlanded` — the *Discard* press.
   */
  removeCrewmate: { ...handleRef, discardUnlanded: Schema.Boolean },
  /** *Look for lost crew work*: finds `crew/*` branches no crewmate owns. */
  orphanScan: {},
  adopt: { ...hostRef, branch: TrimmedNonEmptyString },
  /** Gathers what *Deliver*'s draft names that the snapshot does not hold. */
  deliverDraft: {},
  /** Reserves a block of crew ports on a dev service; you send Fen the draft that declares them. */
  addCrewPorts: {
    ...hostRef,
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: CREW_PORTS_MAX })),
  },
  appRun: handleRef,
  appStop: handleRef,
});
export type CrewCommand = typeof CrewCommand.Type;

/**
 * Whose logins a press reaches — D6 at the crew's door. A crewmate runs on a
 * login someone signed in (PRD §2.3), and only that person may run it; so a
 * command that runs or changes the crew is refused, at its entry, for a
 * person who may not run one of the logins it reaches, and a client offers it
 * to nobody else. Nothing a crewmate does later can then trace to a press of
 * someone who may not run it: a queued task, a resumed run, a landing that
 * starts the next task.
 *
 * - `crewmates` — the named crewmates' own: a message or an answer, a new
 *   task's owner, a conversation cleared, memory, the app, Show on dev, a
 *   removal, a branch adopted as a copy;
 * - `job` — the crewmate's, and the login the crew home now names for it;
 * - `tasks` — each task's crewmate's;
 * - `claim` — that of the crewmate the dev service's claim names;
 * - `tell` — the lead's, with a lead; else each crewmate mentioned;
 * - `crew` — every crewmate's: a run's start, resume or finish, the goal;
 * - `home` — every crewmate's, and every login the crew home names: Apply;
 * - `stops` — none: any member may stop or pause a running crew, since a
 *   colleague must be able to stop what they may not start (D6) — a runaway
 *   crew on somebody's account never waits for them;
 * - `reads` — none: a draft's facts, lost work found, ports proposed.
 */
export type CrewCommandReach =
  | { readonly kind: "reads" }
  | { readonly kind: "stops" }
  | { readonly kind: "crew" }
  | { readonly kind: "home" }
  | { readonly kind: "crewmates"; readonly handles: ReadonlyArray<string> }
  | { readonly kind: "job"; readonly handle: string }
  | { readonly kind: "tasks"; readonly taskIds: ReadonlyArray<string> }
  | { readonly kind: "claim"; readonly host: string }
  | { readonly kind: "tell"; readonly handles: ReadonlyArray<string> };

export function crewCommandReach(command: CrewCommand): CrewCommandReach {
  switch (command._tag) {
    case "orphanScan":
    case "deliverDraft":
    case "addCrewPorts":
      return { kind: "reads" };
    case "pause":
    case "stop":
      return { kind: "stops" };
    case "start":
    case "resume":
    case "finish":
    case "briefSave":
    case "thawHost":
      return { kind: "crew" };
    case "apply":
      return { kind: "home" };
    case "rebuildCopy":
    case "operationContinue":
    case "operationDiscard":
    case "useCrewCopy":
    case "message":
    case "answer":
    case "showOnDev":
    case "startFresh":
    case "memoryEdit":
    case "memoryRemove":
    case "forgetMemory":
    case "removeCrewmate":
    case "appRun":
    case "appStop":
      return { kind: "crewmates", handles: [command.handle] };
    case "taskCreate":
      return { kind: "crewmates", handles: [command.owner] };
    case "adopt":
      return { kind: "crewmates", handles: [command.branch.replace(/^crew\//u, "")] };
    case "jobSave":
      return { kind: "job", handle: command.handle };
    case "taskEdit":
    case "discard":
    case "markFresh":
    case "taskRetry":
    case "review":
    case "land":
    case "landNow":
    case "askResolve":
    case "askFix":
      return { kind: "tasks", taskIds: [command.taskId] };
    case "planAccept":
    case "planDiscard":
      return { kind: "tasks", taskIds: command.taskIds };
    case "claimGrant":
    case "claimDeny":
    case "claimRelease":
      return { kind: "claim", host: command.host };
    case "tell":
      return { kind: "tell", handles: command.mentions.map((mention) => mention.handle) };
  }
}

/**
 * The crew as a reach resolves against it — the engine's tables on the
 * server, the snapshot in a client — so both name the same logins.
 */
export interface CrewLoginRoster {
  /** Every crewmate, the lead's kind included, with the login it runs on. */
  readonly crewmates: ReadonlyArray<{
    readonly handle: string;
    readonly kind: CrewMemberKind;
    readonly login: string;
  }>;
  /** A task's crewmate. */
  readonly ownerOf: (taskId: string) => string | undefined;
  /** The crewmate a dev service's Show-on-dev claim names. */
  readonly claimOf: (host: string) => string | undefined;
  /** The crew home's crewmates and the login each would run on, for `home` and `job`. */
  readonly home?: ReadonlyArray<{ readonly handle: string; readonly login: string }>;
}

/** The logins `reach` reaches, each once, the crew's order first. */
export function crewReachLogins(
  reach: CrewCommandReach,
  roster: CrewLoginRoster,
): ReadonlyArray<string> {
  const loginOf = (handle: string | undefined) =>
    roster.crewmates.find((mate) => mate.handle === handle)?.login;
  const homeLoginOf = (handle: string) =>
    roster.home?.find((mate) => mate.handle === handle)?.login;
  const logins = (candidates: ReadonlyArray<string | undefined>): ReadonlyArray<string> => [
    ...new Set(candidates.filter((login): login is string => login !== undefined)),
  ];
  const every = roster.crewmates.map((mate) => mate.login);
  switch (reach.kind) {
    case "reads":
    case "stops":
      return [];
    case "crew":
      return logins(every);
    case "home":
      return logins([...every, ...(roster.home ?? []).map((mate) => mate.login)]);
    case "crewmates":
      return logins(reach.handles.map(loginOf));
    case "job":
      return logins([loginOf(reach.handle), homeLoginOf(reach.handle)]);
    case "tasks":
      return logins(reach.taskIds.map((taskId) => loginOf(roster.ownerOf(taskId))));
    case "claim":
      return logins([loginOf(roster.claimOf(reach.host))]);
    case "tell": {
      const lead = roster.crewmates.find((mate) => mate.kind === "lead");
      return lead === undefined ? logins(reach.handles.map(loginOf)) : [lead.login];
    }
  }
}

/**
 * A file of the crew home, relative to it: `crew.yaml`, `brief.md` or
 * `jobs/<handle>.md` — nothing else is readable or writable through the files
 * RPCs, so no path can leave the home.
 */
export const CREW_FILE_PATH_PATTERN = new RegExp(
  `^(?:crew\\.yaml|brief\\.md|jobs/${CREW_HANDLE_PATTERN.source.slice(1, -1)}\\.md)$`,
);
export const CrewFilePath = Schema.String.check(Schema.isPattern(CREW_FILE_PATH_PATTERN));
export type CrewFilePath = typeof CrewFilePath.Type;

/**
 * The crew home's files (`zerops.crew.files.get` returns every one present;
 * `zerops.crew.files.put` writes the ones listed and leaves the rest).
 */
export const CrewFiles = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: CrewFilePath, content: Schema.String })),
});
export type CrewFiles = typeof CrewFiles.Type;

/** A `crew/*` branch on a dev service that no crewmate owns (CONCEPT §3.1 *Adopt*). */
export const CrewOrphan = Schema.Struct({
  host: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  /** Its commits your tree does not have. */
  ahead: NonNegativeInt,
});
export type CrewOrphan = typeof CrewOrphan.Type;

/**
 * What a command answers beyond the next snapshot. Only three commands need a
 * reply, each carrying facts the snapshot cannot: it is read from SQLite, and
 * these are read over ssh. The client-runtime composes the drafts from them.
 */
export const CrewCommandResult = Schema.TaggedUnion({
  done: {},
  /** `deliverDraft`: paths dirty in your tree that no landing produced. */
  deliverDraft: { dirtyPaths: Schema.Array(Schema.String) },
  /** `addCrewPorts`: the ports reserved for the draft to declare. */
  crewPorts: { ...hostRef, ports: Schema.NonEmptyArray(PortSchema) },
  orphans: { orphans: Schema.Array(CrewOrphan) },
});
export type CrewCommandResult = typeof CrewCommandResult.Type;

/**
 * Why the engine refused a command or a files request. The words for each are
 * `crewRefusalSentence` in the client-runtime phrases; `detail` names the
 * specifics (a file, a handle, admission's own reason).
 */
export const CrewRefusalReason = Schema.Literals([
  /** Crew mode is off here (not a Zerops Mate, or the switch is off). */
  "unavailable",
  /** Nothing is applied yet. */
  "no-crew",
  /** The crew home fails validation (PRD §5.1); `detail` names the rule. */
  "invalid-definition",
  "handle-taken",
  "no-free-disk",
  /** A writer on a service with a database declares neither `env:` nor `database: shared`. */
  "database-undeclared",
  /** *Tell the crew* without a lead and without a mention (PRD §5.3). */
  "no-mention",
  "unknown-crewmate",
  "unknown-task",
  /** The task, run or claim is not in a state the command applies to. */
  "wrong-state",
  /** Admission refused the turn (D6: not this login's signer, or not an active member). */
  "not-allowed",
  /** `removeCrewmate` on a copy with unlanded commits, without `discardUnlanded`. */
  "unlanded-commits",
  /** `jobSave` with a changed login and an `apply` other than `fresh`. */
  "login-needs-fresh",
  /** The crew home could not be read or written. */
  "io",
]);
export type CrewRefusalReason = typeof CrewRefusalReason.Type;

export class CrewCommandError extends Schema.TaggedError<CrewCommandError>()("CrewCommandError", {
  reason: CrewRefusalReason,
  detail: Schema.NullOr(Schema.String),
}) {
  override get message(): string {
    return this.detail === null
      ? `Crew command refused (${this.reason})`
      : `Crew command refused (${this.reason}): ${this.detail}`;
  }
}
