import * as Schema from "effect/Schema";
import { MatePresence } from "./hqMates.ts";
import { MateOverview } from "./mateLink.ts";
import { RecipeTierResponse } from "./hqRecipe.ts";
import { HqDecision } from "./hqOffers.ts";
import { AppReadValue } from "./hqAppReads.ts";
import { HqChange } from "./hqChanges.ts";

/** HQ ended this structure segment as planned; open the next segment with a fresh ticket. */
export const HQ_STREAM_SEGMENT_CLOSE = { code: 4410, reason: "segment over" } as const;

/** Official HQ verdict carried by the navigation scope's `org` value; null before first check. */
export type HqOfficialVerdict =
  | "ok"
  | "anchor_missing"
  | "anchor_elsewhere"
  | "credentials_wrong"
  | "unknown";

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
export const HqScopeReady = Schema.Struct({
  type: Schema.Literal("scope-ready"),
  scope: HqScope,
  ...HqCursor.fields,
});
export const HqMoveOffersMessage = Schema.Struct({
  type: Schema.Literal("move-offers"),
  requestId: Schema.String,
  projectId: Schema.String,
  moveTo: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export const HqMoveOffersError = Schema.Struct({
  type: Schema.Literal("move-offers-error"),
  requestId: Schema.String,
  projectId: Schema.String,
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

const AttentionId = Schema.String.check(Schema.isPattern(/\S/u));

/** Structural ingest seam matching AREV's contracts/zeropsAttention.ts until both lanes integrate. */
export const HqAttentionValue = Schema.Struct({
  source: Schema.Struct({
    environmentId: AttentionId,
    incarnation: AttentionId,
    revision: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
    ),
  }),
  mainThreadId: Schema.NullOr(AttentionId),
  lastThreadId: Schema.NullOr(AttentionId),
  working: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  waiting: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  results: Schema.Array(
    Schema.Struct({ threadId: AttentionId, turnId: AttentionId, completedAt: Schema.String }),
  ).check(Schema.isMaxLength(50)),
  questions: Schema.Array(
    Schema.Struct({
      threadId: AttentionId,
      turnId: Schema.NullOr(AttentionId),
      kind: Schema.Literals(["approval", "input", "planReady", "failed"]),
    }),
  ).check(Schema.isMaxLength(50)),
  truncated: Schema.Boolean,
});
export type HqAttentionValue = typeof HqAttentionValue.Type;
export const HqPersonFacts = Schema.Struct({
  role: Schema.String,
  mayWrite: Schema.Boolean,
  mine: Schema.Boolean,
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
  keyWider: Schema.Boolean,
  birthId: Schema.optionalKey(Schema.String),
  signers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export const HqNavigationApp = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  can: Decisions,
  contents: Schema.Struct({
    empty: Schema.Boolean,
    deletingProjectIds: Schema.Array(Schema.String),
  }),
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
  can: Schema.optionalKey(Decisions),
  person: HqPersonFacts,
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
