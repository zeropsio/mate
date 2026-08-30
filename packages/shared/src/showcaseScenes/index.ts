import { sha256 } from "@noble/hashes/sha2";
import * as Encoding from "effect/Encoding";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import agentAuthAttention from "./v1/agent-auth-attention.json" with { type: "json" };
import agentAuthOk from "./v1/agent-auth-ok.json" with { type: "json" };
import cards from "./v1/cards.json" with { type: "json" };
import lifecycleActive from "./v1/lifecycle-active.json" with { type: "json" };
import lifecycleWaiting from "./v1/lifecycle-waiting.json" with { type: "json" };
import noZerops from "./v1/no-zerops.json" with { type: "json" };
import serviceMapDegraded from "./v1/service-map-degraded.json" with { type: "json" };
import serviceMapLive from "./v1/service-map-live.json" with { type: "json" };
import { ZeropsActivityResult } from "./activityResult.ts";
import { ShowcaseSceneJson, type ShowcaseScene } from "./schema.ts";

export { ZeropsActivityResult } from "./activityResult.ts";
export { withoutOptionals, withUnknownShape } from "./variants.ts";
export {
  SHOWCASE_SCENE_ID_PATTERN,
  ShowcaseAgentLoginSnapshot,
  ShowcaseScene,
  ShowcaseSceneJson,
} from "./schema.ts";

export const SHOWCASE_SCENE_IDS = [
  "web:service-map-live",
  "web:service-map-degraded",
  "web:no-zerops",
  "web:lifecycle-active",
  "web:lifecycle-waiting",
  "web:agent-auth-attention",
  "web:agent-auth-ok",
  "web:cards",
] as const;
export type ShowcaseSceneId = (typeof SHOWCASE_SCENE_IDS)[number];

const rawScenes: Record<ShowcaseSceneId, unknown> = {
  "web:service-map-live": serviceMapLive,
  "web:service-map-degraded": serviceMapDegraded,
  "web:no-zerops": noZerops,
  "web:lifecycle-active": lifecycleActive,
  "web:lifecycle-waiting": lifecycleWaiting,
  "web:agent-auth-attention": agentAuthAttention,
  "web:agent-auth-ok": agentAuthOk,
  "web:cards": cards,
};

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const decodeScene = Schema.decodeUnknownSync(ShowcaseSceneJson, strictParseOptions);
const decodeActivityResult = Schema.decodeUnknownSync(ZeropsActivityResult, strictParseOptions);

function assertActivityResults(scene: ShowcaseScene): void {
  for (const activities of Object.values(scene.threadActivities)) {
    for (const activity of activities) {
      const payload =
        Predicate.isObject(activity.payload) && !Array.isArray(activity.payload)
          ? (activity.payload as Record<string, unknown>)
          : undefined;
      const data =
        Predicate.isObject(payload?.data) && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : undefined;
      if (data !== undefined && Object.hasOwn(data, "zerops")) {
        try {
          decodeActivityResult(data.zerops);
        } catch (cause) {
          throw new Error(
            `Showcase scene ${scene.id} activity ${activity.id} has an invalid Zerops result.`,
            { cause },
          );
        }
      }
    }
  }
}

function decodeCheckedScene(id: ShowcaseSceneId): ShowcaseScene {
  let scene: ShowcaseScene;
  try {
    scene = decodeScene(structuredClone(rawScenes[id]));
  } catch (cause) {
    throw new Error(`Showcase scene ${id} does not decode through the current contracts.`, {
      cause,
    });
  }
  if (scene.id !== id) {
    throw new Error(`Showcase scene ${id} declares the mismatched id ${scene.id}.`);
  }
  assertActivityResults(scene);
  return scene;
}

export function loadShowcaseScene(id: ShowcaseSceneId): ShowcaseScene {
  return decodeCheckedScene(id);
}

export function listShowcaseScenes(): ReadonlyArray<ShowcaseScene> {
  return SHOWCASE_SCENE_IDS.map(loadShowcaseScene);
}

const encodeShowcaseScene = Schema.encodeSync(ShowcaseSceneJson, strictParseOptions);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!Predicate.isObject(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

export function canonicalShowcaseSceneHash(scene: ShowcaseScene): string {
  const canonicalJson = JSON.stringify(canonicalize(encodeShowcaseScene(scene)));
  return Encoding.encodeHex(sha256(new TextEncoder().encode(canonicalJson)));
}
