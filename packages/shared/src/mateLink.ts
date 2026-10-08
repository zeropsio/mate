/**
 * The link between a Mate server and its HQ (SPEC §3.4): one outbound WebSocket the Mate server
 * keeps open to HQ, opened with its Mate credential. JSON, one message per frame, each side
 * validating what it reads with these schemas.
 *
 * - **Up**, the Mate's overview for every surface that draws a Mate it has not opened: its main
 *   chat as the shell fields a menu row reads, a digest of its other chats, its logins and its
 *   crew. The whole overview first on every link, then only the sections that changed, at most one
 *   frame per {@link MATE_OVERVIEW_EVERY_MS}. Bounded: texts to {@link MATE_LINK_TEXT_MAX}
 *   characters, titles to {@link MATE_TITLE_MAX}, a frame to {@link MATE_LINK_FRAME_MAX} bytes.
 *   An older Mate's `summary` is a type this build does not know.
 * - **Up**, beside the overview, the Mate's attention (`attention`, `MateAttention` in
 *   `@t3tools/contracts`): one value with its own revision, whole on every link and again at each
 *   new revision. An older HQ passes it by as a type it does not know.
 * - **Down**, the Mate's own state in HQ: its record, its birth (who asked for its stand-up,
 *   whether its project is closed off), and its changes with their outcome (`hqChanges.ts`); and
 *   its access (`access`): who its project opens for and whom it lists, by the door's own rule over
 *   the org's view HQ reads (`mateAccess.ts`), whole after every view, with how old that view is.
 *
 * HQ pings every 20 s and the Mate answers; either side reconnects or closes on silence. A frame
 * whose type this build does not know is passed by (`readLinkUp`), so a newer side never closes an
 * older one's link.
 *
 * @module mateLink
 */
import {
  CrewAttention,
  CrewHandle,
  CrewTask,
  ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentUpdate,
  IsoDateTime,
  MateAttention,
  MateHealth,
  OrchestrationLatestTurn,
  OrchestrationSessionStatus,
  ProviderInteractionMode,
  ThreadId,
  ThreadMessagePreviewRole,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { UsageLinkUp, UsageLinkDown } from "./agentUsage.ts";
import { MateChanges } from "./hqChanges.ts";
import { MateAccessMember } from "./mateAccess.ts";
import { HqAutoUpdatePolicy } from "./mateAutoUpdatePolicy.ts";

export const MATE_LINK_TEXT_MAX = 280;
/** A frame's bound in UTF-8 bytes (`linkFrameBytes`), which the sender checks before it sends. */
export const MATE_LINK_FRAME_MAX = 64 * 1024;
export const MATE_OVERVIEW_EVERY_MS = 500;
export const MATE_TITLE_MAX = 120;
/** The chats an overview lists: every one that is not idle, then the newest. */
export const MATE_OVERVIEW_THREADS_MAX = 40;
export const MATE_LOGINS_MAX = 8;
/** What a live step carries of its calls (`ThreadLiveStep`), cut for a row. */
export const MATE_LIVE_STEP_BOUNDS = { calls: 4, command: 200, inputs: 4, input: 120, files: 3 };
export const MATE_CREW_BOUNDS = { crewmates: 12, attention: 8, readyTasks: 8 };

const Text = Schema.String.check(Schema.isMaxLength(MATE_LINK_TEXT_MAX));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Title = TrimmedNonEmptyString.check(Schema.isMaxLength(MATE_TITLE_MAX));
const Line = TrimmedNonEmptyString.check(Schema.isMaxLength(MATE_LINK_TEXT_MAX));
const atMost = (max: number) => Schema.isMaxLength(max);

/**
 * The Mate as HQ holds it: its record, its birth, and the application it is in with its changes
 * there. A field this build does not know is passed by, so an older Mate reads a newer HQ.
 */
export const MateState = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  face: Schema.String,
  /** The person who asked for the Mate's stand-up, or none yet. */
  standupRequestedBy: Schema.NullOr(Schema.String),
  /** Whether the Mate's project is closed off: its runtimes may be imported. */
  closedOff: Schema.Boolean,
  /** Who signed in each login (`claude-code`, `codex`), keyed by login id: the port's, then the Mate's own link's. */
  signers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  ...MateChanges.fields,
});
export type MateState = typeof MateState.Type;

/**
 * A thread's kind as its Mate resolves it, without a visit: `resolveThreadStatus`'s kinds but
 * `done` and `woke`, which are the reader's (`viewerThreadKind`).
 */
export const MateThreadKind = Schema.Literals([
  "approval",
  "input",
  "failed",
  "connecting",
  "working",
  "planReady",
  "monitoring",
  "idle",
]);
export type MateThreadKind = typeof MateThreadKind.Type;

/** Who the Mate is, as its descriptor says it, and its update line (spec-mate §2.9). */
export const OverviewIdentity = Schema.Struct({
  /** A ready agent outside Mate's personal sign-in flow; absent on older Mates. */
  runsWithoutSignIn: Schema.optionalKey(Schema.Boolean),
  environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
  serverVersion: ExecutionEnvironmentDescriptor.fields.serverVersion,
  update: Schema.NullOr(ExecutionEnvironmentUpdate),
});
export type OverviewIdentity = typeof OverviewIdentity.Type;

/** A call a running turn makes (`ThreadLiveCall`), cut to {@link MATE_LIVE_STEP_BOUNDS}. */
const LiveCall = Schema.Struct({
  id: TrimmedNonEmptyString,
  activityKind: TrimmedNonEmptyString,
  itemType: TrimmedNonEmptyString,
  title: Line,
  detail: Schema.optional(Line),
  toolName: Schema.optional(Line),
  command: Schema.optional(TrimmedNonEmptyString.check(atMost(MATE_LIVE_STEP_BOUNDS.command))),
  input: Schema.optional(
    Schema.Record(Schema.String, Schema.String.check(atMost(MATE_LIVE_STEP_BOUNDS.input))).check(
      Schema.isMaxProperties(MATE_LIVE_STEP_BOUNDS.inputs),
    ),
  ),
  imagePath: Schema.optional(Line),
  files: Schema.optional(Schema.Array(Line).check(atMost(MATE_LIVE_STEP_BOUNDS.files))),
  startedAt: IsoDateTime,
});

/** What the running turn is on (`ThreadLiveStep`): the row phrases it as the run's card does. */
const LiveStep = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thinking"), since: IsoDateTime }),
  Schema.Struct({ kind: Schema.Literal("writing"), since: IsoDateTime }),
  Schema.Struct({
    kind: Schema.Literal("calls"),
    since: IsoDateTime,
    calls: Schema.Array(LiveCall).check(atMost(MATE_LIVE_STEP_BOUNDS.calls)),
  }),
]);

/**
 * The Mate's main chat (`resolvePrimaryConversation`) as the shell fields its menu row reads
 * (`threadAgentActivity`) and nothing more: the reader runs the same derivations over them,
 * finishing the status with its own visit. Texts masked and cut by the Mate.
 */
export const OverviewMain = Schema.Struct({
  id: ThreadId,
  title: Title,
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
  interactionMode: ProviderInteractionMode,
  backgroundLiveness: Schema.NullOr(Schema.Literals(["working", "monitoring"])),
  session: Schema.NullOr(
    Schema.Struct({ status: OrchestrationSessionStatus, lastError: Schema.NullOr(Text) }),
  ),
  latestTurn: Schema.NullOr(
    Schema.Struct({
      turnId: OrchestrationLatestTurn.fields.turnId,
      state: OrchestrationLatestTurn.fields.state,
      requestedAt: OrchestrationLatestTurn.fields.requestedAt,
      startedAt: OrchestrationLatestTurn.fields.startedAt,
      completedAt: OrchestrationLatestTurn.fields.completedAt,
    }),
  ),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  latestUserMessagePreview: Schema.NullOr(Schema.Struct({ text: Text })),
  latestMessagePreview: Schema.NullOr(
    Schema.Struct({ role: ThreadMessagePreviewRole, text: Text }),
  ),
  planProgress: Schema.NullOr(Schema.Struct({ step: Text })),
  pendingQuestion: Schema.NullOr(Text),
  usagePause: Schema.NullOr(Schema.Struct({ resetsAt: IsoDateTime })),
  liveStep: Schema.NullOr(LiveStep),
});
export type OverviewMain = typeof OverviewMain.Type;

/** One chat of the Mate's, a crewmate's never: what a notification and an unread dot read. */
export const ThreadDigest = Schema.Struct({
  id: ThreadId,
  title: Title,
  kind: MateThreadKind,
  turnId: Schema.NullOr(OrchestrationLatestTurn.fields.turnId),
  turnState: Schema.NullOr(OrchestrationLatestTurn.fields.state),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadDigest = typeof ThreadDigest.Type;

export const OverviewThreads = Schema.Struct({
  list: Schema.Array(ThreadDigest).check(atMost(MATE_OVERVIEW_THREADS_MAX)),
  /** The chats past the list. */
  omitted: Count,
});
export type OverviewThreads = typeof OverviewThreads.Type;

/** An agent login (`claude-code`, `codex`, …): who signed it in, and what its lock reads. */
export const LoginDigest = Schema.Struct({
  /** A Zerops user id, or nobody yet. */
  signedInBy: Schema.NullOr(Schema.String),
  /** Last recorded signer for the owner badge; never authority to spend a login. */
  lastSignedInBy: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Its credential is there. */
  present: Schema.Boolean,
  /** An API key, not a person's sign-in. */
  token: Schema.Boolean,
});
export type LoginDigest = typeof LoginDigest.Type;

export const OverviewLogins = Schema.Record(Schema.String, LoginDigest).check(
  Schema.isMaxProperties(MATE_LOGINS_MAX),
);
export type OverviewLogins = typeof OverviewLogins.Type;

/**
 * An applied crew as the sidebar draws it (`SidebarCrewLine`). An open vocabulary — a tint, an
 * attention kind — travels as a string, so a newer crew never closes an older HQ's link.
 */
export const CrewDigest = Schema.Struct({
  crewmates: Schema.Array(
    Schema.Struct({
      handle: CrewHandle,
      displayName: TrimmedNonEmptyString,
      tint: TrimmedNonEmptyString,
      lead: Schema.Boolean,
      /** Its current stint's chat, and that chat's kind. */
      threadId: Schema.NullOr(ThreadId),
      threadKind: Schema.NullOr(MateThreadKind),
      /** The login its turns spend, resolved by the Mate. */
      loginKey: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ).check(atMost(MATE_CREW_BOUNDS.crewmates)),
  attention: Schema.Array(
    Schema.Struct({
      id: CrewAttention.fields.id,
      kind: TrimmedNonEmptyString,
      handle: CrewAttention.fields.handle,
    }),
  ).check(atMost(MATE_CREW_BOUNDS.attention)),
  readyTasks: Schema.Array(
    Schema.Struct({ id: CrewTask.fields.id, owner: CrewTask.fields.owner }),
  ).check(atMost(MATE_CREW_BOUNDS.readyTasks)),
  /** The person lands ready work themselves (`crewPersonLands`). */
  personLands: Schema.Boolean,
});
export type CrewDigest = typeof CrewDigest.Type;

/**
 * A Mate's crew as its menu and its line read it (`CrewStatus`): crew mode off, on with no crew
 * yet — its menu offers to set one up — or a crew applied, its digest beside its status.
 */
export const OverviewCrew = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["off", "none"]) }),
  Schema.Struct({ status: Schema.Literal("applied"), ...CrewDigest.fields }),
]);
export type OverviewCrew = typeof OverviewCrew.Type;

/** Everything a Mate tells HQ of itself, by section: a section is always replaced whole. */
export const MateOverview = Schema.Struct({
  identity: OverviewIdentity,
  main: Schema.NullOr(OverviewMain),
  threads: OverviewThreads,
  logins: OverviewLogins,
  crew: OverviewCrew,
});
export type MateOverview = typeof MateOverview.Type;

/** The sections of an overview that changed since the Mate's last frame on this link. */
export const MateOverviewSections = Schema.Struct({
  identity: Schema.optionalKey(MateOverview.fields.identity),
  main: Schema.optionalKey(MateOverview.fields.main),
  threads: Schema.optionalKey(MateOverview.fields.threads),
  logins: Schema.optionalKey(MateOverview.fields.logins),
  crew: Schema.optionalKey(MateOverview.fields.crew),
});
export type MateOverviewSections = typeof MateOverviewSections.Type;

export const MateLinkUp = Schema.Union([
  Schema.Struct({ type: Schema.Literal("auto-update-policy"), requestId: Schema.String }),
  UsageLinkUp,
  Schema.Struct({ type: Schema.Literal("pong") }),
  Schema.Struct({
    type: Schema.Literal("overview"),
    full: Schema.Literal(true),
    overview: MateOverview,
  }),
  Schema.Struct({
    type: Schema.Literal("overview"),
    full: Schema.Literal(false),
    sections: MateOverviewSections,
  }),
  Schema.Struct({ type: Schema.Literal("health"), health: MateHealth }),
  Schema.Struct({ type: Schema.Literal("attention"), attention: MateAttention }),
]);
export type MateLinkUp = typeof MateLinkUp.Type;

export const MateLinkDown = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("auto-update-policy"),
    requestId: Schema.String,
    policy: HqAutoUpdatePolicy,
  }),
  ...UsageLinkDown.members,
  Schema.Struct({ type: Schema.Literal("ping") }),
  Schema.Struct({
    type: Schema.Literal("state"),
    mate: MateState,
    autoUpdate: Schema.optionalKey(HqAutoUpdatePolicy),
    usage: Schema.optionalKey(
      Schema.Struct({
        capture: Schema.Int,
        report: Schema.Int,
        mateId: TrimmedNonEmptyString,
        /** The org HQ holds the Mate in; a Mate captures nothing until HQ names it. */
        orgId: Schema.optionalKey(TrimmedNonEmptyString),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("access"),
    /** How long before it was sent Zerops answered the view it was computed from. */
    ageMs: Count,
    members: Schema.Array(MateAccessMember),
  }),
]);
export type MateLinkDown = typeof MateLinkDown.Type;

/**
 * A frame up the link as this build reads it: a message it knows, one it passes by, or none at
 * all — not a JSON object with a type, or a type it knows whose body does not decode.
 */
export type LinkUpRead =
  | { readonly kind: "message"; readonly message: MateLinkUp }
  | { readonly kind: "unknown"; readonly type: string }
  | { readonly kind: "invalid" };

const INVALID: LinkUpRead = { kind: "invalid" };

const UP_TYPES: ReadonlySet<string> = new Set(
  MateLinkUp.members.map((member) => member.fields.type.literal),
);
const decodeLinkUp = Schema.decodeUnknownOption(MateLinkUp);

/** Reads one frame up the link. A type this build does not know is passed by, never refused. */
export function readLinkUp(frame: string): LinkUpRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return INVALID;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return INVALID;
  const { type } = parsed as { readonly type?: unknown };
  if (typeof type !== "string") return INVALID;
  if (!UP_TYPES.has(type)) return { kind: "unknown", type };
  return Option.match(decodeLinkUp(parsed), {
    onNone: () => INVALID,
    onSome: (message) => ({ kind: "message", message }),
  });
}

const utf8 = new TextEncoder();

/** A frame's size as the bound counts it: UTF-8 bytes, never a string's UTF-16 length. */
export function linkFrameBytes(frame: string): number {
  return utf8.encode(frame).byteLength;
}
