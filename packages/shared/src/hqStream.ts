import { MateAttention as HqAttentionValue } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { MatePresence } from "./hqMates.ts";
import { MateOverview } from "./mateLink.ts";
import { RecipeTierResponse } from "./hqRecipe.ts";
import { HqDecision } from "./hqOffers.ts";
import { AppReadValue } from "./hqAppReads.ts";
import { CompareQuery, CompareResponse, RepoName, HqChange } from "./hqChanges.ts";
import { EnvironmentBirth, HqDeployOutcome } from "./hqDeploys.ts";
import { ReleaseRollout } from "./hqRelease.ts";

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

/** Official HQ verdict carried by the navigation scope's `org` value; null before first check. */
export type HqOfficialVerdict =
  | "ok"
  | "anchor_missing"
  | "anchor_elsewhere"
  | "credentials_wrong"
  | "unknown";

/** A small navigation fact; status ticks do not replace organization or project values. */
export const HqNavigationStatus = Schema.Struct({
  official: Schema.NullOr(
    Schema.Literals(["ok", "anchor_missing", "anchor_elsewhere", "credentials_wrong", "unknown"]),
  ),
  parts: Schema.Record(Schema.String, Schema.Unknown),
});
export type HqNavigationStatus = typeof HqNavigationStatus.Type;

/** One renderer opens one socket for its organization and registers only demanded scopes. */
export const HqScope = Schema.Union([
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
  Schema.Struct({ kind: Schema.Literal("attention"), projectId: Schema.String }),
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
export const HqCoreProtocol = Schema.Struct({
  protocol: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  build: Schema.optionalKey(Schema.String),
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
  waitsOnViewer: Schema.Boolean,
  /** Today's overview does not prove result identities: unknown until source attention arrives. */
  unseen: Schema.NullOr(Schema.Int),
});
export type HqPersonFacts = typeof HqPersonFacts.Type;

const Decisions = Schema.Record(Schema.String, HqDecision);
export const HqNavigationMate = Schema.Struct({
  face: Schema.String,
  madeBy: Schema.NullOr(Schema.String),
  standupRequestedBy: Schema.NullOr(Schema.String),
  closedOff: Schema.Boolean,
  /** Presence of the setup press marker; null until HQ has usable evidence. */
  setupMarker: Schema.NullOr(Schema.Boolean),
  keyWider: Schema.Boolean,
  birthId: Schema.optionalKey(Schema.String),
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
export const HqNavigationEnvironment = Schema.Struct({
  projectId: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
  name: Schema.String,
  sources: Schema.Array(Schema.String),
  order: Schema.Number,
  keyHeld: Schema.Boolean,
  keyInvalid: Schema.Boolean,
  can: Decisions,
  jobs: Schema.Array(HqNavigationJob),
  release: Schema.NullOr(ReleaseRollout),
  birth: Schema.NullOr(EnvironmentBirth),
});
export type HqNavigationEnvironment = typeof HqNavigationEnvironment.Type;
export const HqNavigationEnvironments = Schema.Union([
  Schema.Array(HqNavigationEnvironment),
  Schema.Struct({ refused: Schema.String }),
]);
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
  title: HqChange.fields.title,
  state: Schema.Literal("open"),
  hasHead: Schema.Boolean,
  updatedAt: HqChange.fields.updatedAt,
  mergeability: HqChange.fields.mergeability,
  ready: Schema.Boolean,
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
    subjects: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
    total: Schema.Int,
    more: Schema.Int,
    atLeast: Schema.Boolean,
  }),
  gate: HqDecision,
  inFlight: Schema.NullOr(Schema.String),
});
export type HqNavigationReleaseOffer = typeof HqNavigationReleaseOffer.Type;
export const HqNavigationRelease = Schema.Union([
  Schema.NullOr(HqNavigationReleaseOffer),
  Schema.Struct({ refused: Schema.String }),
]);

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
});
export type HqNavigationApp = typeof HqNavigationApp.Type;
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
/** Independent app-detail record values, keyed as documented in hq-scopes.md. */
export const HqAppDetailFields = {
  releases: AppReadValue.fields.releases,
  repos: AppReadValue.fields.repos,
  "recipe:mate": RecipeTierResponse,
  "recipe:stage": RecipeTierResponse,
  "recipe:production": RecipeTierResponse,
  changes: Schema.Array(HqChange),
};

export const HqAttentionScopeValue = Schema.Struct({
  presence: MatePresence,
  overview: Schema.NullOr(MateOverview),
  attention: Schema.NullOr(HqAttentionValue),
  attentionState: Schema.Literals(["live", "stored", "none"]),
});
export type HqAttentionScopeValue = typeof HqAttentionScopeValue.Type;
