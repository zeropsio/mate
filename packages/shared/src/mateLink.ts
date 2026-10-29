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
 * - **Up**, in the overview of a Mate whose conversation runs on the engine, the engine's own rows
 *   (`conversations`, `ConversationRow` in `@t3tools/contracts`) beside the main chat's shell
 *   fields, and the protocol they speak (`identity.engine`). Both keys are optional: a V1 Mate sends
 *   neither, and an HQ from before them drops both and still takes the frame — a key a struct does
 *   not know is passed by.
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
  ConversationRow,
  CrewAttention,
  MateInterruption,
  CrewHandle,
  CrewTask,
  ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentUpdate,
  IsoDateTime,
  MateAttention,
  MateHealth,
  MateTask,
  MateTaskMessage,
  MateTaskReport,
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
import { MateChanges, MateRepo } from "./hqChanges.ts";
import { MateGitPush } from "./hqDeploys.ts";
import { ChiefMateOwner, MateAccessMember } from "./mateAccess.ts";
import { HqAutoUpdatePolicy } from "./mateAutoUpdatePolicy.ts";

export const MATE_LINK_TEXT_MAX = 280;
/** A frame's bound in UTF-8 bytes (`linkFrameBytes`), which the sender checks before it sends. */
export const MATE_LINK_FRAME_MAX = 64 * 1024;
export const MATE_OVERVIEW_EVERY_MS = 500;
export const MATE_TITLE_MAX = 120;
/** The chats an overview lists: every one that is not idle, then the newest. */
export const MATE_OVERVIEW_THREADS_MAX = 40;
/** The engine conversations an overview carries rows of: every one that is not idle, then the newest. */
export const MATE_OVERVIEW_CONVERSATIONS_MAX = 40;
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
  /**
   * The Zerops user HQ records as the Mate's owner (`mateOwner`), or none named: everyone else
   * reads along. Absent from an HQ older than it, and where HQ could not read its org yet.
   */
  ownerUserId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * An automated Mate: it takes tasks from outside (`MateTask`) and runs only on the
   * organization's API keys, never on a person's subscription. Absent from an older HQ: not one.
   */
  automated: Schema.optionalKey(Schema.Boolean),
  ...MateChanges.fields,
  /**
   * Each Git environment of its application, its latest confirmed push per repository with the
   * origin's CI, in the application's environment order. Only `GET /api/mate/self` answers it:
   * absent from the link's state and from an older HQ.
   */
  gitPushes: Schema.optionalKey(Schema.Array(MateGitPush)),
  /**
   * Whether its application has a production, of any target, released or not. Only `GET
   * /api/mate/self` answers it: absent from the link's state and from an older HQ.
   */
  production: Schema.optionalKey(Schema.Boolean),
  /**
   * Each repository of its application by name, with its connected origin's address. Only `GET
   * /api/mate/self` answers it: absent from the link's state and from an older HQ.
   */
  repos: Schema.optionalKey(Schema.Array(MateRepo)),
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
  /** The engine its conversation runs on, by the protocol its rows speak; absent on a V1 Mate. */
  engine: Schema.optionalKey(Schema.Struct({ protocol: Schema.Int })),
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
    Schema.Struct({
      status: OrchestrationSessionStatus,
      lastError: Schema.NullOr(Text),
      interruption: Schema.optional(Schema.NullOr(MateInterruption)),
    }),
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
  /** Refusal evidence, not a permanent admission verdict. Absent only on legacy frames. */
  refusal: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        turnId: Schema.NullOr(OrchestrationLatestTurn.fields.turnId),
        provider: Text,
        resetsAt: Schema.NullOr(IsoDateTime),
      }),
    ),
  ),
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

/**
 * An engine Mate's conversations as the engine rows them (`conversationRowOf`): the state, subject
 * and snippet a menu row reads, texts masked and cut by the Mate. Its literals are the engine's
 * forward-compatible sets, so a state a later engine adds reads as `unknown`, never a refusal.
 */
export const OverviewConversations = Schema.Array(ConversationRow).check(
  atMost(MATE_OVERVIEW_CONVERSATIONS_MAX),
);
export type OverviewConversations = typeof OverviewConversations.Type;

/** Everything a Mate tells HQ of itself, by section: a section is always replaced whole. */
export const MateOverview = Schema.Struct({
  identity: OverviewIdentity,
  main: Schema.NullOr(OverviewMain),
  threads: OverviewThreads,
  logins: OverviewLogins,
  crew: OverviewCrew,
  /** An engine Mate's own rows; absent on a V1 Mate. */
  conversations: Schema.optionalKey(OverviewConversations),
});
export type MateOverview = typeof MateOverview.Type;

/** The sections of an overview that changed since the Mate's last frame on this link. */
export const MateOverviewSections = Schema.Struct({
  identity: Schema.optionalKey(MateOverview.fields.identity),
  main: Schema.optionalKey(MateOverview.fields.main),
  threads: Schema.optionalKey(MateOverview.fields.threads),
  logins: Schema.optionalKey(MateOverview.fields.logins),
  crew: Schema.optionalKey(MateOverview.fields.crew),
  conversations: Schema.optionalKey(OverviewConversations),
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
  /** How a task HQ handed it stands (`MateTaskReport`): once taken, then on each move. */
  Schema.Struct({ type: Schema.Literal("task-state"), report: MateTaskReport }),
]);
export type MateLinkUp = typeof MateLinkUp.Type;

/** HQ's answer to the Mate's `auto-update-policy` ask, by the ask's id. */
const AutoUpdatePolicyDown = Schema.Struct({
  type: Schema.Literal("auto-update-policy"),
  requestId: Schema.String,
  policy: HqAutoUpdatePolicy,
});

/** What a `state` frame carries beside the Mate: the org's update policy and the usage lane. */
const StateExtras = {
  /** HQ's ping period on this link; absent on older HQs, which have no receive-silence guard. */
  pingIntervalMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
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
};

/** A task for an automated Mate to work: told again until the Mate says it took it. */
const TaskDown = Schema.Struct({ type: Schema.Literal("task"), task: MateTask });

/** Something said about a task its Mate took (`MateTaskMessage`): heard in its conversation. */
const TaskMessageDown = Schema.Struct({
  type: Schema.Literal("task-message"),
  taskId: TrimmedNonEmptyString,
  message: MateTaskMessage,
  /**
   * The task's change, where it opened one: its repository, number and branch on HQ's git, the
   * branch a follow-up's working copy starts from. An older HQ names none; an older Mate reads
   * past it.
   */
  change: Schema.optionalKey(
    Schema.Struct({
      repo: TrimmedNonEmptyString,
      number: Schema.Int,
      branch: TrimmedNonEmptyString,
    }),
  ),
});

/** People stopped a task its Mate took (issue closed, label removed): its run stops, it says so. */
const TaskStopDown = Schema.Struct({
  type: Schema.Literal("task-stop"),
  taskId: TrimmedNonEmptyString,
  reason: Schema.String,
  /**
   * HQ put the task back in line before it heard the Mate take it (the monthly budget was
   * reached): its runs stop, and nothing of the stop is kept, so the Mate takes it again when
   * HQ hands it again. Absent: people stopped it for good. A Mate that predates it stops it so.
   */
  requeued: Schema.optionalKey(Schema.Literal(true)),
});

/**
 * The organization's API keys an automated Mate's agents run on, by the variable its provider
 * reads (`NEBIUS_API_KEY`, `OPENCODE_KEY_PROVIDERS`); sent on each link to an automated Mate only,
 * and again when one changes. An empty list: none set.
 */
const ProviderKeysDown = Schema.Struct({
  type: Schema.Literal("provider-keys"),
  keys: Schema.Array(Schema.Struct({ env: TrimmedNonEmptyString, value: Schema.String })),
  /**
   * The model the organization picked for its automated Mates, as an OpenCode slug
   * (`nebius/zai-org/GLM-5.3-Flash`, one of `automatedModels`), told again when it changes.
   * Absent: none picked, or an older HQ — the Mate's default. An older Mate reads past it.
   */
  model: Schema.optionalKey(TrimmedNonEmptyString),
});

export const MateLinkDown = Schema.Union([
  AutoUpdatePolicyDown,
  ...UsageLinkDown.members,
  Schema.Struct({ type: Schema.Literal("ping") }),
  Schema.Struct({ type: Schema.Literal("state"), mate: MateState, ...StateExtras }),
  Schema.Struct({
    type: Schema.Literal("access"),
    /** How long before it was sent Zerops answered the view it was computed from. */
    ageMs: Count,
    members: Schema.Array(MateAccessMember),
    /** Explicitly null for an ordinary Mate; absent only on older HQs. */
    chief: Schema.optionalKey(Schema.NullOr(ChiefMateOwner)),
  }),
  TaskDown,
  TaskMessageDown,
  TaskStopDown,
  ProviderKeysDown,
]);
export type MateLinkDown = typeof MateLinkDown.Type;

/*
 * The keys model's link (mate-hq `spec/protocol.md`, "Mate link"): the Mate dials
 * HQ with nothing in the URL and proves itself with its project key in the first frame; HQ sends
 * its state, then the organisation's access with a version and the time of the view it was
 * computed from. Today's frames of tasks, usage and the update policy ride on it unchanged.
 * Today's `MateLinkUp`, `MateLinkDown` and `MateState` above stay for the HQ and clients that
 * still read them.
 */

/** `GET /api/mate/self`, and the `mate` of a `state` frame: `chief` names the mark's project. */
export const MateSelf = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  face: Schema.String,
  standupRequestedBy: Schema.NullOr(Schema.String),
  closedOff: Schema.Boolean,
  signers: Schema.Record(Schema.String, Schema.String),
  automated: Schema.optionalKey(Schema.Boolean),
  ...MateChanges.fields,
  chief: Schema.NullOr(Schema.Struct({ projectId: Schema.String })),
});
export type MateSelf = typeof MateSelf.Type;

/** The Mate as a `state` frame brings it: its self read, with its owner where HQ knows one. */
export const LinkedMate = Schema.Struct({
  ...MateSelf.fields,
  ownerUserId: Schema.optionalKey(Schema.String),
});
export type LinkedMate = typeof LinkedMate.Type;

/** A member's reach into the Mate's project; `none` removes the member in a delta. */
export const LinkAccessMember = Schema.Struct({
  userId: Schema.String,
  role: Schema.Literals(["NO_ACCESS", "READ_ONLY", "BASIC_USER", "ADMIN", "OWNER"]),
  visibility: Schema.Literals(["open", "listed", "none"]),
});
export type LinkAccessMember = typeof LinkAccessMember.Type;

const AccessVersion = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Ticket = Schema.String.check(Schema.isMinLength(1));

export const KeyLinkUp = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("hello"),
    key: Schema.String.check(Schema.isMinLength(1)),
    serviceId: Schema.String,
    /** The Mate's public origin, `https://host`: HQ hands it to a client that asks for a ticket. */
    origin: Schema.String.check(Schema.isMinLength(1)),
    /** What the Git credential the Mate holds is, never its secret: HQ keeps a live one this names. */
    gitFingerprint: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))),
  }),
  ...MateLinkUp.members,
  Schema.Struct({ type: Schema.Literal("ticket-ack"), ticket: Ticket }),
  Schema.Struct({
    type: Schema.Literal("observe-credential-ack"),
    id: Schema.String,
    ok: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("key-refused") }),
]);
export type KeyLinkUp = typeof KeyLinkUp.Type;

/**
 * The organisation's key was refused: the Mate admits nobody until a full frame without it.
 * First in its union, so a frame marked `refused` never decodes as a snapshot.
 */
export const RefusedAccessFrame = Schema.Struct({
  type: Schema.Literal("access"),
  version: AccessVersion,
  full: Schema.Literal(true),
  refused: Schema.Literal(true),
  members: Schema.Tuple([]),
});

/** Who the project opens for and lists: a full snapshot, or a delta of the entries that changed. */
export const AccessFrame = Schema.Struct({
  type: Schema.Literal("access"),
  version: AccessVersion,
  viewAt: Schema.String,
  full: Schema.Boolean,
  members: Schema.Array(LinkAccessMember),
});

export const KeyLinkDown = Schema.Union([
  AutoUpdatePolicyDown,
  ...UsageLinkDown.members,
  Schema.Struct({ type: Schema.Literal("ping") }),
  Schema.Struct({ type: Schema.Literal("state"), mate: LinkedMate, ...StateExtras }),
  RefusedAccessFrame,
  AccessFrame,
  Schema.Struct({
    type: Schema.Literal("ticket"),
    ticket: Ticket,
    userId: Schema.String,
    sessionId: Schema.String,
    expiresIn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  }),
  Schema.Struct({ type: Schema.Literal("close-session"), sessionId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("git-credential"),
    credential: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("observe-credential"),
    id: Schema.String,
    credential: Schema.NullOr(Schema.String),
  }),
  TaskDown,
  TaskMessageDown,
  TaskStopDown,
  ProviderKeysDown,
]);
export type KeyLinkDown = typeof KeyLinkDown.Type;
/** An access frame as the Mate keeps it: a snapshot, a delta, or the refused one. */
export type KeyLinkAccess = Extract<KeyLinkDown, { readonly type: "access" }>;

/** A key HQ does not admit: the close reason of `4403`, and the code of the same refusal on a call. */
export const KeyNotAdmitted = Schema.Literals([
  "key_too_wide",
  "key_not_sensitive",
  "not_a_mate",
  "org_not_started",
]);
export type KeyNotAdmitted = typeof KeyNotAdmitted.Type;

/** How HQ closes a link: `4409` superseded, `4408` silence, `1001` going away, `1012` service restart, `1007` malformed, `1009` too big, `1011` unreadable. */
export const MateLinkClosed = Schema.Union([
  Schema.Struct({ code: Schema.Literal(4401), reason: Schema.Literal("key_refused") }),
  Schema.Struct({ code: Schema.Literal(4403), reason: KeyNotAdmitted }),
  Schema.Struct({ code: Schema.Literals([1001, 1007, 1009, 1011, 1012, 4408, 4409]) }),
]);
export type MateLinkClosed = typeof MateLinkClosed.Type;

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
