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

/**
 * A captured API triple — the shape `GET /project/{id}` (its `service-stack`
 * list) and `GET /project/{id}/process` return, the exact inputs the client
 * projection consumes (`packages/client-runtime/src/zerops/topology.ts`'s
 * `projectTopology(project, services, processes)`). Not the server's old
 * `zcp studio topology` snapshot: what exists in a Zerops project is a client
 * read now (spec §0), never a server feed, so a scene carries the platform
 * shapes the client itself decodes rather than a server-shaped one.
 */
const ShowcaseTopologyProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  publicZone: Schema.optionalKey(Schema.String),
  zeropsSubdomainHost: Schema.optionalKey(Schema.String),
});

const ShowcaseTopologyServicePort = Schema.Struct({
  port: Schema.Number,
  protocol: Schema.optionalKey(Schema.String),
  scheme: Schema.optionalKey(Schema.String),
  httpSupport: Schema.optionalKey(Schema.Boolean),
});

const ShowcaseTopologyService = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  isSystem: Schema.optionalKey(Schema.Boolean),
  subdomainAccess: Schema.optionalKey(Schema.Boolean),
  ports: Schema.optionalKey(Schema.Array(ShowcaseTopologyServicePort)),
  serviceStackTypeInfo: Schema.optionalKey(
    Schema.Struct({
      serviceStackTypeName: Schema.optionalKey(Schema.String),
      serviceStackTypeVersionName: Schema.optionalKey(Schema.String),
      serviceStackTypeCategory: Schema.optionalKey(Schema.String),
    }),
  ),
});

const ShowcaseTopologyProcess = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  serviceStackIds: Schema.Array(Schema.String),
  status: Schema.String,
  actionName: Schema.String,
  created: Schema.String,
  started: Schema.optionalKey(Schema.String),
  finished: Schema.optionalKey(Schema.String),
});

export const ShowcaseTopologySource = Schema.Struct({
  project: ShowcaseTopologyProject,
  services: Schema.Array(ShowcaseTopologyService),
  processes: Schema.Array(ShowcaseTopologyProcess),
});
export type ShowcaseTopologySource = typeof ShowcaseTopologySource.Type;

const ShowcaseSceneStep = Schema.Struct({
  afterMs: NonNegativeInt,
  lifecycle: Schema.optional(ZeropsLifecycle),
  agentAuth: Schema.optional(ZeropsAgentAuthSnapshot),
  agentLogin: Schema.optional(ShowcaseAgentLoginSnapshot),
}).check(
  Schema.makeFilter((step) =>
    step.lifecycle !== undefined || step.agentAuth !== undefined || step.agentLogin !== undefined
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
  topologySource: ShowcaseTopologySource,
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
