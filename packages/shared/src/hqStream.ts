import { MateHealth } from "@t3tools/contracts";
import { MateAttention as HqAttentionValue } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { hqEnvironmentCodec, HqDirectGitTarget } from "./hqEnvironment.ts";
import { AgentUsageScope, AGENT_USAGE_REPORT_PROTOCOL } from "@t3tools/contracts";
import { usageCanonical } from "./agentUsage.ts";
import { MatePresence } from "./hqMates.ts";
import { MateOverview } from "./mateLink.ts";
import { RecipeTierResponse } from "./hqRecipe.ts";
import { HqDecision } from "./hqOffers.ts";
import { AppReadValue } from "./hqAppReads.ts";
import { HqPullRequest } from "./hqGithub.ts";
import { CompareQuery, CompareResponse, RepoName, HqChange } from "./hqChanges.ts";
import { EnvironmentBirth, HqDeployOutcome, HqPushOutcome } from "./hqDeploys.ts";
import { ReleaseRollout, HqReleaseTarget, TierStop } from "./hqRelease.ts";

export { HqAttentionValue };

/** HQ ended this structure segment as planned; open the next segment with a fresh ticket. */
export const HQ_STREAM_SEGMENT_CLOSE = { code: 4410, reason: "segment over" } as const;

/** A definitive source refusal ends the attempt; segment rotation cannot retry it. */
export const HQ_ZEROPS_REFUSED = { status: 403, code: "zerops_refused" } as const;
export const HqZeropsRefusedResponse = Schema.Struct({
  code: Schema.Literal(HQ_ZEROPS_REFUSED.code),
  reason: Schema.optionalKey(Schema.String),
});
export type HqZeropsRefusedResponse = typeof HqZeropsRefusedResponse.Type;
export const HQ_STREAM_REFUSED_CLOSE = { code: 4403, reason: "zerops refused" } as const;

/** Client adapters handle session renewal separately; other transport endings preserve facts. */
export const hqStreamCloseFailure = (code: number) => {
  if (code === HQ_STREAM_REFUSED_CLOSE.code)
    return { code: HQ_ZEROPS_REFUSED.code, disposition: "refused" } as const;
  if (code === 4401) return { code: "session_ended", disposition: "session-ended" } as const;
  return { code: `socket_${code}`, disposition: "transient" } as const;
};

/** A small navigation fact; status ticks do not replace organization or project values. */
export const HqNavigationStatus = Schema.Struct({
  parts: Schema.Record(Schema.String, Schema.Unknown),
});
export type HqNavigationStatus = typeof HqNavigationStatus.Type;

/** One renderer opens one socket for its organization and registers only demanded scopes. */
export const HqScope = Schema.Union([
  AgentUsageScope,
  Schema.Struct({ kind: Schema.Literal("navigation") }),
  Schema.Struct({ kind: Schema.Literal("app-detail"), appId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("change"),
    appId: Schema.String,
    repo: Schema.String,
    number: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("discussion"),
    appId: Schema.String,
    repo: Schema.String,
    number: Schema.Int,
  }),
  Schema.Struct({ kind: Schema.Literal("operation"), appId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("attention"),
    projectId: Schema.String,
    /**
     * `apart`: the reader takes the Mate's health as its own value ({@link HQ_ATTENTION_HEALTH_KEY}),
     * so a health sample never resends the Mate's record. An HQ from before it passes the key by
     * and sends health inside the record, as it does to a reader that does not ask; the scope's
     * key ({@link hqScopeKey}) is the same either way, so a reader reads either HQ's answer.
     */
    health: Schema.optionalKey(Schema.Literal("apart")),
  }),
]);
export type HqScope = typeof HqScope.Type;
export const HqCursor = Schema.Struct({
  incarnation: Schema.String,
  revision: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
});
export type HqCursor = typeof HqCursor.Type;
export const HqRemoval = Schema.Struct({
  key: Schema.String,
  reason: Schema.Literals(["deleted", "no-access"]),
});
export type HqRemoval = typeof HqRemoval.Type;
export const HqValue = Schema.Struct({ key: Schema.String, value: Schema.Unknown });
export type HqValue = typeof HqValue.Type;
export const HqSubscription = Schema.Struct({
  scope: HqScope,
  cursor: Schema.optionalKey(HqCursor),
  /** Keys retained by the renderer, for explicit removals after a Core incarnation changes. */
  knownKeys: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(10000))),
}).check(
  Schema.makeFilter((subscription) =>
    subscription.cursor !== undefined && subscription.knownKeys === undefined
      ? "A resume needs retained keys to prove removals after journal eviction or Core restart"
      : undefined,
  ),
);
export type HqSubscription = typeof HqSubscription.Type;
export const HqStreamRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("retry"),
    /** Omitted scopes retry this person's refused journals, including before subscribing. */
    scopes: Schema.optionalKey(Schema.Array(HqScope).check(Schema.isMaxLength(128))),
  }),
  Schema.Struct({
    type: Schema.Literal("subscribe"),
    scopes: Schema.Array(HqSubscription).check(Schema.isMaxLength(128)),
  }),
  Schema.Struct({
    type: Schema.Literal("unsubscribe"),
    scopes: Schema.Array(HqScope).check(Schema.isMaxLength(128)),
  }),
  Schema.Struct({
    type: Schema.Literal("seen"),
    projectId: Schema.String,
    resultIds: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
  }),
  Schema.Struct({
    type: Schema.Literal("move-offers"),
    requestId: Schema.String,
    projectId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("handover-candidates"),
    requestId: Schema.String,
    projectId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("compare"),
    requestId: Schema.String,
    appId: Schema.String,
    repo: RepoName,
    ...CompareQuery.fields,
  }),
  Schema.Struct({ type: Schema.Literal("pong") }),
]);
export type HqStreamRequest = typeof HqStreamRequest.Type;

/** Each message commits atomically. Missing or unreadable values never remove prior facts. */
export const HqScopeDelivery = Schema.Struct({
  type: Schema.Literals(["scope-reset", "scope-values"]),
  scope: HqScope,
  ...HqCursor.fields,
  values: Schema.Array(HqValue),
  removals: Schema.Array(HqRemoval),
});
export type HqScopeDelivery = typeof HqScopeDelivery.Type;
export const HqScopeFailure = Schema.Struct({
  type: Schema.Literal("scope-error"),
  scope: HqScope,
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(["refused", "transient", "corrupt"]),
});
export type HqScopeFailure = typeof HqScopeFailure.Type;
/** Raised when the client requires new navigation facts; independent of the build label. */
export const HQ_NAVIGATION_PROTOCOL = 1;
export const AUTO_UPDATE_POLICY_PROTOCOL = 1;
export const HqCoreProtocol = Schema.Struct({
  protocol: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  build: Schema.optionalKey(Schema.String),
  autoUpdatePolicy: Schema.optionalKey(Schema.Literal(AUTO_UPDATE_POLICY_PROTOCOL)),
  agentUsage: Schema.optionalKey(Schema.Literal(AGENT_USAGE_REPORT_PROTOCOL)),
});
export type HqCoreProtocol = typeof HqCoreProtocol.Type;

export const HqScopeReady = Schema.Struct({
  /** Absent from a Core predating protocol negotiation; support remains unknown. */
  core: Schema.optionalKey(Schema.Unknown),
  type: Schema.Literal("scope-ready"),
  scope: HqScope,
  ...HqCursor.fields,
});
export const HqMoveOffersMessage = Schema.Struct({
  type: Schema.Literal("move-offers"),
  requestId: Schema.String,
  projectId: Schema.String,
  moveTo: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  refused: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
  ),
});
export const HqMoveOffersError = Schema.Struct({
  type: Schema.Literal("move-offers-error"),
  requestId: Schema.String,
  projectId: Schema.String,
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(["refused", "transient"]),
});
export const HqNavigationPerson = Schema.Struct({
  name: Schema.String,
  clientUserId: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type HqNavigationPerson = typeof HqNavigationPerson.Type;
export const HqHandoverCandidate = Schema.Struct({
  userId: Schema.String,
  ...HqNavigationPerson.fields,
});
export type HqHandoverCandidate = typeof HqHandoverCandidate.Type;
export const HqHandoverCandidatesMessage = Schema.Struct({
  type: Schema.Literal("handover-candidates"),
  requestId: Schema.String,
  projectId: Schema.String,
  candidates: Schema.Array(HqHandoverCandidate),
});
export const HqHandoverCandidatesError = Schema.Struct({
  type: Schema.Literal("handover-candidates-error"),
  requestId: Schema.String,
  projectId: Schema.String,
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(["refused", "transient"]),
});
/** On-demand read; the result has the same shape as Changes.compare. Never broadcast. */
export const HqCompareMessage = Schema.Struct({
  type: Schema.Literal("compare"),
  requestId: Schema.String,
  appId: Schema.String,
  repo: RepoName,
  result: CompareResponse,
});
export const HqCompareError = Schema.Struct({
  type: Schema.Literal("compare-error"),
  requestId: Schema.String,
  appId: Schema.String,
  repo: RepoName,
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(["refused", "transient"]),
});
export const HqStreamMessage = Schema.Union([
  HqScopeDelivery,
  HqScopeFailure,
  HqScopeReady,
  HqMoveOffersMessage,
  HqMoveOffersError,
  HqHandoverCandidatesMessage,
  HqHandoverCandidatesError,
  HqCompareMessage,
  HqCompareError,
  Schema.Struct({ type: Schema.Literal("ping") }),
]);
export type HqStreamMessage = typeof HqStreamMessage.Type;

export const hqScopeKey = (scope: HqScope): string => {
  switch (scope.kind) {
    case "navigation":
      return "navigation";
    case "agentUsage":
      return usageCanonical([scope.kind, scope.query, scope.detail ?? null]);
    case "app-detail":
    case "operation":
      return JSON.stringify([scope.kind, scope.appId]);
    case "change":
    case "discussion":
      return JSON.stringify([scope.kind, scope.appId, scope.repo, scope.number]);
    case "attention":
      return JSON.stringify([scope.kind, scope.projectId]);
  }
};

export const HqPersonFacts = Schema.Struct({
  role: Schema.String,
  mayWrite: Schema.Boolean,
  mine: Schema.Boolean,
  ownerUserId: Schema.NullOr(Schema.String),
  /** This Mate's person's registered Chief; absent from an older HQ. */
  chiefProjectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  waitsOnViewer: Schema.Boolean,
  /** Today's overview does not prove result identities: unknown until source attention arrives. */
  unseen: Schema.NullOr(Schema.Int),
  /** The project is a Chief: the viewer's own, or another person's. Absent from an older HQ. */
  chief: Schema.optionalKey(Schema.Literals(["mine", "another"])),
});
export type HqPersonFacts = typeof HqPersonFacts.Type;

const Decisions = Schema.Record(Schema.String, HqDecision);
/** The task an automated Mate is on, as its row names it. */
export const HqNavigationMateTask = Schema.Struct({
  id: Schema.String,
  /** A GitHub issue's repository and number; absent for a task from elsewhere. */
  repo: Schema.optionalKey(Schema.String),
  number: Schema.optionalKey(Schema.Int),
  title: Schema.String,
  /** Where it came from, linked; none for a schedule's. */
  url: Schema.NullOr(Schema.String),
  /** Where it came from in people's words ("acme/tea-shop#12", "#support on Slack"). */
  label: Schema.optionalKey(Schema.String),
  /** It waits for a person's answer (`MateTaskReport.question`); absent: it works or rests. */
  waiting: Schema.optionalKey(Schema.Literal(true)),
  /** HQ took a person's stop of it and its Mate has not stopped yet; absent: no stop asked. */
  stopping: Schema.optionalKey(Schema.Literal(true)),
  /**
   * Its Mate finished it and its change waits for review: the Mate holds it until the change is
   * merged or closed. Absent: at work, waiting, stopping, or ended (`ended`), or an older HQ.
   */
  done: Schema.optionalKey(Schema.Literal(true)),
  /** The pull request its change is mirrored to on GitHub; absent where none. */
  pullRequest: Schema.optionalKey(HqPullRequest),
  /**
   * How it ended, for the Mate's most recent task while no other is live: the Mate is free and
   * its row says so, while the task's own conversation still shows where it got to. Absent: live.
   */
  ended: Schema.optionalKey(Schema.Literals(["merged", "closed", "done", "failed", "stopped"])),
  /** When it ended — its change merged or closed, else it — for an ended task; absent while live. */
  endedAt: Schema.optionalKey(Schema.String),
  /**
   * Why HQ stopped it, for a stopped task: this month's budget spent, or its question unanswered
   * for three days. Absent: a person or its Mate stopped it, or an older HQ.
   */
  why: Schema.optionalKey(Schema.Literals(["budget", "unanswered"])),
  /** When its Mate took it; absent from an older HQ. */
  startedAt: Schema.optionalKey(Schema.String),
  /** What it cost and how long it worked so far, as its Mate last reported. */
  spentUsd: Schema.optionalKey(Schema.Number),
  workedMs: Schema.optionalKey(Schema.Number),
});
export type HqNavigationMateTask = typeof HqNavigationMateTask.Type;
export const HqNavigationMate = Schema.Struct({
  face: Schema.String,
  madeBy: Schema.NullOr(Schema.String),
  standupRequestedBy: Schema.NullOr(Schema.String),
  closedOff: Schema.Boolean,
  /** Presence of the setup press marker; null until HQ has usable evidence. */
  setupMarker: Schema.NullOr(Schema.Boolean),
  /** Still sent by older HQ builds; no client reads it. */
  keyWider: Schema.optionalKey(Schema.Boolean),
  birthId: Schema.optionalKey(Schema.String),
  /** An automated Mate (`MateState.automated`); absent from an older HQ: not one. */
  automated: Schema.optionalKey(Schema.Boolean),
  /** The task an automated Mate is on, or none: what its row names while it works. */
  task: Schema.optionalKey(Schema.NullOr(HqNavigationMateTask)),
});
/** Bounded environment jobs, retaining the latest live job for each service too. */
export const HqNavigationJob = Schema.Struct({
  id: Schema.String,
  kind: HqDeployOutcome.fields.kind,
  service: HqDeployOutcome.fields.service,
  sha: HqDeployOutcome.fields.sha,
  state: HqDeployOutcome.fields.state,
  cause: Schema.Literals([
    "merge",
    "release",
    "run_again",
    "add_service",
    "env_added",
    "key_kept",
    "import",
    "migrated",
  ]),
  ref: Schema.NullOr(Schema.String),
  reason: HqDeployOutcome.fields.reason,
  appVersionId: Schema.NullOr(Schema.String),
  processId: HqDeployOutcome.fields.processId,
  evidence: HqDeployOutcome.fields.evidence,
  steps: HqDeployOutcome.fields.steps,
  verifiedVersionId: HqDeployOutcome.fields.verifiedVersionId,
  requestedBy: Schema.NullOr(Schema.String),
  at: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  supersededBy: Schema.NullOr(Schema.String),
});
export type HqNavigationJob = typeof HqNavigationJob.Type;
/** Direct-delivery readers opt into the push state contract; old Zerops readers are unchanged. */
export const HqPushNavigationJob = Schema.Struct({
  ...HqNavigationJob.fields,
  kind: HqPushOutcome.fields.kind,
  service: HqPushOutcome.fields.service,
  sha: HqPushOutcome.fields.sha,
  state: HqPushOutcome.fields.state,
  processId: HqPushOutcome.fields.processId,
  evidence: HqPushOutcome.fields.evidence,
  steps: HqPushOutcome.fields.steps,
  appVersionId: Schema.Null,
  verifiedVersionId: HqPushOutcome.fields.verifiedVersionId,
}).check(
  Schema.makeFilter((value) =>
    Schema.decodeUnknownExit(HqPushOutcome)({
      ...value,
      environment: "",
      job: value.id,
      behind: null,
    })._tag === "Success"
      ? undefined
      : "Expected a valid direct-delivery job",
  ),
);
export type HqPushNavigationJob = typeof HqPushNavigationJob.Type;
export const HqDeliveryNavigationJob = Schema.Union([HqNavigationJob, HqPushNavigationJob]);
export type HqDeliveryNavigationJob = typeof HqDeliveryNavigationJob.Type;

/** @deprecated Use CanonicalHqNavigationEnvironment at the HQ read boundary. */
export const HqNavigationEnvironment = Schema.Struct({
  projectId: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
  name: Schema.String,
  sources: Schema.Array(Schema.String),
  order: Schema.Number,
  keyHeld: Schema.Boolean,
  keyInvalid: Schema.Boolean,
  deleteProjectOnRemoval: Schema.optionalKey(Schema.Boolean),
  can: Decisions,
  jobs: Schema.Array(HqNavigationJob),
  release: Schema.NullOr(ReleaseRollout),
  birth: Schema.NullOr(EnvironmentBirth),
  tierStops: Schema.optionalKey(Schema.Array(TierStop)),
});
export type HqNavigationEnvironment = typeof HqNavigationEnvironment.Type;
/** @deprecated Use CanonicalHqNavigationEnvironments at the HQ read boundary. */
export const HqNavigationEnvironments = Schema.Union([
  Schema.Array(HqNavigationEnvironment),
  Schema.Struct({ refused: Schema.String }),
]);
/** Canonical readers normalize older HQ rows at this boundary only. */
export const CanonicalHqNavigationEnvironment = hqEnvironmentCodec(
  Struct.omit(HqNavigationEnvironment.fields, ["projectId"]),
);
export type CanonicalHqNavigationEnvironment = typeof CanonicalHqNavigationEnvironment.Type;
/** Explicit Git records are additive; existing canonical Zerops reader types remain stable. */
export const HqGitNavigationEnvironment = Schema.Struct({
  ...CanonicalHqNavigationEnvironment.to.fields,
  target: HqDirectGitTarget,
  jobs: Schema.Array(HqPushNavigationJob),
});
export type HqGitNavigationEnvironment = typeof HqGitNavigationEnvironment.Type;

export const CanonicalHqNavigationEnvironments = Schema.Union([
  Schema.Array(CanonicalHqNavigationEnvironment),
  Schema.Struct({ refused: Schema.String }),
]);
export type CanonicalHqNavigationEnvironments = typeof CanonicalHqNavigationEnvironments.Type;
/** Remaining hold duration from HQ's read; transport silence never decides its outcome. */
export const HqNavigationPress = Schema.Struct({
  kind: Schema.Literals(["mate", "stage", "production"]),
  appId: Schema.optionalKey(Schema.String),
  heldForMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  until: Schema.String,
  importProcessId: Schema.optionalKey(Schema.String),
});
export type HqNavigationPress = typeof HqNavigationPress.Type;
/** Only what the menu draws and orders; commit contents and history belong to detail scopes. */
export const HqNavigationChange = Schema.Struct({
  repo: HqChange.fields.repo,
  number: HqChange.fields.number,
  mateProjectId: HqChange.fields.mateProjectId,
  mateGone: HqChange.fields.mateGone,
  title: HqChange.fields.title,
  state: Schema.Literal("open"),
  hasHead: Schema.Boolean,
  updatedAt: HqChange.fields.updatedAt,
  mergeability: HqChange.fields.mergeability,
  ready: Schema.Boolean,
  /** The pull request it is mirrored to on GitHub; absent where none. */
  pullRequest: HqChange.fields.pullRequest,
});
export type HqNavigationChange = typeof HqNavigationChange.Type;
export const HqNavigationChanges = Schema.Union([
  Schema.Array(HqNavigationChange),
  Schema.Struct({ refused: Schema.String }),
]);
/** Compact navigation offer; review contents and service entries remain in detail. */
export const HqNavigationReleaseOffer = Schema.Struct({
  head: Schema.NullOr(Schema.String),
  suggestion: Schema.String,
  summary: Schema.Struct({
    /** Change titles when changeCount is present; legacy commit subjects are not overview labels. */
    subjects: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
    changeCount: Schema.optionalKey(Schema.Int),
    total: Schema.Int,
    more: Schema.Int,
    atLeast: Schema.Boolean,
  }),
  /**
   * Present, as "pending", while `summary` is not known: the offer's inputs moved and HQ has not
   * read the candidate again, or Git could not read it. `summary` then counts nothing. Absent where
   * `summary` is the read count, and from older servers.
   */
  summaryRead: Schema.optionalKey(Schema.Literal("pending")),
  gate: HqDecision,
  releaseTarget: Schema.optionalKey(HqReleaseTarget),
  inFlight: Schema.NullOr(Schema.String),
});
export type HqNavigationReleaseOffer = typeof HqNavigationReleaseOffer.Type;
export const HqNavigationRelease = Schema.Union([
  Schema.NullOr(HqNavigationReleaseOffer),
  Schema.Struct({ refused: Schema.String }),
]);

/** An application's intake as its menu reads it: where its tasks come from, and how many wait. */
export const HqNavigationIntake = Schema.Struct({
  repo: Schema.String,
  label: Schema.String,
  waiting: Schema.Int,
  /** It takes a public repository's issues (`HqIntakeRequest.public`); absent: it does not. */
  public: Schema.optionalKey(Schema.Literal(true)),
});
export type HqNavigationIntake = typeof HqNavigationIntake.Type;

/**
 * One of an application's recent rollouts as its navigation carries it: whether HQ planned it, and
 * HQ's words for what it could not ask for — what a handed-over answer (`HqDeployAnswer.rollout`)
 * ends its wait with when the rollout was planned with no job.
 */
export const HqNavigationRollout = Schema.Struct({
  id: Schema.String,
  planned: Schema.Boolean,
  note: Schema.NullOr(Schema.String),
});
export type HqNavigationRollout = typeof HqNavigationRollout.Type;

/** @deprecated Use CanonicalHqNavigationApp at the HQ read boundary. */
export const HqNavigationApp = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  can: Decisions,
  contents: Schema.Struct({
    empty: Schema.Boolean,
    deletingProjectIds: Schema.Array(Schema.String),
  }),
  environments: HqNavigationEnvironments,
  changes: HqNavigationChanges,
  releaseOffer: HqNavigationRelease,
  projectIds: Schema.Array(Schema.String),
  births: Schema.Array(Schema.Unknown),
  /**
   * Where the application's automated Mates take tasks from (`HqIntake`), and how many wait for
   * one of them to be free; null: nowhere. Absent from an older HQ.
   */
  intake: Schema.optionalKey(Schema.NullOr(HqNavigationIntake)),
  /**
   * Its recent rollouts, newest first, to whoever reads its environments. Absent from an older HQ,
   * and a rollout not listed: not known, never planned.
   */
  rollouts: Schema.optionalKey(Schema.Array(HqNavigationRollout)),
});
export type HqNavigationApp = typeof HqNavigationApp.Type;
/** Additive canonical reader; the legacy app DTO remains usable until consumers migrate. */
export const CanonicalHqNavigationApp = Schema.Struct({
  ...HqNavigationApp.fields,
  environments: CanonicalHqNavigationEnvironments,
});
export type CanonicalHqNavigationApp = typeof CanonicalHqNavigationApp.Type;
export const HqNavigationProject = Schema.Struct({
  projectId: Schema.String,
  appId: Schema.NullOr(Schema.String),
  name: Schema.String,
  kind: Schema.String,
  mate: Schema.NullOr(HqNavigationMate),
  /** Environment projects include finish: the attach decision for their current placement. */
  can: Schema.optionalKey(Decisions),
  person: HqPersonFacts,
  /** Login ID to current person; only credentials present and not API tokens. */
  signedInNow: Schema.Record(Schema.String, Schema.String),
  /** Login ID to its latest known person, including saved history after sign-out. */
  everSignedIn: Schema.Record(Schema.String, Schema.String),
});
export type HqNavigationProject = typeof HqNavigationProject.Type;
/** Independent app-detail record values keyed by the fields below. */
export const HqAppDetailFields = {
  releases: AppReadValue.fields.releases,
  repos: AppReadValue.fields.repos,
  "recipe:mate": RecipeTierResponse,
  "recipe:stage": RecipeTierResponse,
  "recipe:production": RecipeTierResponse,
  changes: Schema.Array(HqChange),
  /** Every change a release would put live now; `pending` while HQ has not recorded them. */
  releaseChanges: Schema.Union([
    Schema.Struct({ state: Schema.Literal("pending") }),
    Schema.Struct({
      state: Schema.Literal("known"),
      changes: Schema.Array(
        Schema.Struct({ repo: Schema.String, number: Schema.Int, title: Schema.String }),
      ),
    }),
  ]),
  /**
   * The commits a release would carry that no change landed: their number and the newest few.
   * `summaryRead: "pending"` while HQ has not read them (count 0, no commits).
   */
  releaseOutside: Schema.Struct({
    count: Schema.Int,
    commits: Schema.Array(
      Schema.Struct({
        repo: Schema.String,
        sha: Schema.String,
        subject: Schema.String,
        authorName: Schema.String,
        at: Schema.String,
      }),
    ),
    summaryRead: Schema.optionalKey(Schema.Literal("pending")),
  }),
};

export const HqAttentionScopeValue = Schema.Struct({
  health: Schema.optionalKey(Schema.NullOr(MateHealth)),
  healthState: Schema.optionalKey(Schema.Literals(["live", "stored", "none"])),
  presence: MatePresence,
  overview: Schema.NullOr(MateOverview),
  attention: Schema.NullOr(HqAttentionValue),
  attentionState: Schema.Literals(["live", "stored", "none"]),
});
export type HqAttentionScopeValue = typeof HqAttentionScopeValue.Type;
/** The key of a Mate's health in its attention scope, for a reader that takes health apart. */
export const HQ_ATTENTION_HEALTH_KEY = "health";
/** A Mate's health as its own value: the sample, and whether HQ hears it from the Mate now. */
export const HqAttentionHealthValue = Schema.Struct({
  health: HqAttentionScopeValue.fields.health,
  healthState: HqAttentionScopeValue.fields.healthState,
});
export type HqAttentionHealthValue = typeof HqAttentionHealthValue.Type;
