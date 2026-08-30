import {
  NonNegativeInt,
  OrchestrationProjectShell,
  OrchestrationThreadActivity,
  OrchestrationThreadShell,
  ThreadId,
  ZeropsAgentId,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginState,
  ZeropsLifecycle,
  ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const SHOWCASE_SCENE_ID_PATTERN = /^web:[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const WebShowcaseSceneId = Schema.NonEmptyString.check(Schema.isPattern(SHOWCASE_SCENE_ID_PATTERN));

/** The server-internal login feed snapshot, before it is merged into agent auth for clients. */
export const ShowcaseAgentLoginSnapshot = Schema.Record(
  ZeropsAgentId,
  Schema.optionalKey(ZeropsAgentLoginState),
);
export type ShowcaseAgentLoginSnapshot = typeof ShowcaseAgentLoginSnapshot.Type;

const ShowcaseSceneStep = Schema.Struct({
  afterMs: NonNegativeInt,
  topology: Schema.optional(ZeropsTopologySnapshot),
  lifecycle: Schema.optional(ZeropsLifecycle),
  agentAuth: Schema.optional(ZeropsAgentAuthSnapshot),
  agentLogin: Schema.optional(ShowcaseAgentLoginSnapshot),
}).check(
  Schema.makeFilter((step) =>
    step.topology !== undefined ||
    step.lifecycle !== undefined ||
    step.agentAuth !== undefined ||
    step.agentLogin !== undefined
      ? undefined
      : "Expected at least one feed snapshot",
  ),
);

export const ShowcaseScene = Schema.Struct({
  version: Schema.Literal(1),
  id: WebShowcaseSceneId,
  title: Schema.NonEmptyString,
  synthetic: Schema.Boolean,
  source: Schema.Struct({
    recordedAt: Schema.DateTimeUtc,
    from: Schema.Literals(["z3-eval", "authored"]),
  }),
  topology: ZeropsTopologySnapshot,
  lifecycle: ZeropsLifecycle,
  agentAuth: ZeropsAgentAuthSnapshot,
  agentLogin: ShowcaseAgentLoginSnapshot,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  threadActivities: Schema.Record(ThreadId, Schema.Array(OrchestrationThreadActivity)),
  steps: Schema.optional(Schema.Array(ShowcaseSceneStep)),
});
export type ShowcaseScene = typeof ShowcaseScene.Type;

/** JSON representation keeps ISO timestamps on disk while decoding to the public contract types. */
export const ShowcaseSceneJson = Schema.toCodecJson(ShowcaseScene);
