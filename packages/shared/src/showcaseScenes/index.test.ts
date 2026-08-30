// @effect-diagnostics nodeBuiltinImport:off - This lock test intentionally reads checked-in fixture bytes.
import * as NodeFS from "node:fs";

import { describe, expect, it, vi } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import contractsPackageJson from "../../../contracts/package.json" with { type: "json" };
import { ZeropsActivityResult } from "./activityResult.ts";
import cardsSceneJson from "./v1/cards.json" with { type: "json" };
import {
  SHOWCASE_SCENE_ID_PATTERN,
  SHOWCASE_SCENE_IDS,
  canonicalShowcaseSceneHash,
  listShowcaseScenes,
  loadShowcaseScene,
} from "./index.ts";
import { ShowcaseSceneJson } from "./schema.ts";

const decodeActivityResult = Schema.decodeUnknownSync(ZeropsActivityResult);
const decodeScene = Schema.decodeUnknownSync(ShowcaseSceneJson);
const encodeScene = Schema.encodeSync(ShowcaseSceneJson);
const scenesLockJson = JSON.parse(
  NodeFS.readFileSync(new URL("./v1/scenes.lock", import.meta.url), "utf8"),
) as {
  contractsVersion: string;
  scenes: Record<string, string>;
};

function activityData(scene: ReturnType<typeof loadShowcaseScene>, activityId: string) {
  const activity = Object.values(scene.threadActivities)
    .flat()
    .find(({ id }) => id === activityId);
  expect(activity, `missing activity ${activityId}`).toBeDefined();
  const payload =
    Predicate.isObject(activity?.payload) && !Array.isArray(activity.payload)
      ? (activity.payload as Record<string, unknown>)
      : undefined;
  const data =
    Predicate.isObject(payload?.data) && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : undefined;
  expect(data, `activity ${activityId} has no projected data`).toBeDefined();
  return data!;
}

describe("showcase scene bundle", () => {
  it("loads and contract-decodes every checked-in scene", () => {
    expect(listShowcaseScenes().map(({ id }) => id)).toEqual([...SHOWCASE_SCENE_IDS]);
    for (const id of SHOWCASE_SCENE_IDS) {
      expect(loadShowcaseScene(id).id).toBe(id);
    }
  });

  it("isolates unknown activity payloads from later loads and the raw module", () => {
    const rawZerops = cardsSceneJson.threadActivities["cards-thread"][0]!.payload.data.zerops;
    if (rawZerops === undefined) {
      throw new Error("cards-deploy raw fixture has no Zerops result");
    }
    const originalToolName = rawZerops.toolName;
    const first = loadShowcaseScene("web:cards");
    const firstZerops = activityData(first, "cards-deploy").zerops as Record<string, unknown>;

    try {
      firstZerops.toolName = "MUTATED";
      const second = loadShowcaseScene("web:cards");

      expect.soft(activityData(second, "cards-deploy").zerops).toMatchObject({
        toolName: originalToolName,
      });
      expect.soft(rawZerops.toolName).toBe(originalToolName);
      expect.soft(canonicalShowcaseSceneHash(second)).toBe(scenesLockJson.scenes[second.id]);
    } finally {
      rawZerops.toolName = originalToolName;
    }
  });

  it("imports without decoding and names an invalid scene when it is loaded", async () => {
    vi.resetModules();
    vi.doMock("./v1/cards.json", () => ({ default: { version: 2 } }));
    try {
      const sceneModule = await import("./index.ts").then(
        (module) => module,
        () => undefined,
      );

      expect(sceneModule, "importing the scene module must not decode fixtures").toBeDefined();
      expect(() => sceneModule!.loadShowcaseScene("web:cards")).toThrowError(
        "Showcase scene web:cards does not decode through the current contracts.",
      );
    } finally {
      vi.doUnmock("./v1/cards.json");
      vi.resetModules();
    }
  });

  it("uses reserved web capture ids", () => {
    expect(SHOWCASE_SCENE_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of SHOWCASE_SCENE_IDS) {
      expect(id).toMatch(SHOWCASE_SCENE_ID_PATTERN);
    }
  });

  it("matches the checked-in scene lock and contracts version", () => {
    expect(scenesLockJson.contractsVersion).toBe(contractsPackageJson.version);
    expect(Object.keys(scenesLockJson.scenes)).toEqual([...SHOWCASE_SCENE_IDS]);
    for (const scene of listShowcaseScenes()) {
      expect(scenesLockJson.scenes[scene.id]).toBe(canonicalShowcaseSceneHash(scene));
    }
  });

  it("decodes a timed lifecycle step and rejects a step with no feed snapshot", () => {
    const scene = loadShowcaseScene("web:lifecycle-active");
    const encodedScene = encodeScene(scene);

    expect(scene.steps).toMatchObject([
      {
        afterMs: 2_000,
        lifecycle: {
          threadId: "showcase-thread",
          envelope: { phase: "develop-closed-auto" },
          recentTools: [{ toolName: "zerops_deploy", status: "completed" }],
        },
      },
    ]);

    expect(Predicate.isObject(encodedScene) && !Array.isArray(encodedScene)).toBe(true);
    if (Predicate.isObject(encodedScene) && !Array.isArray(encodedScene)) {
      expect(() =>
        decodeScene({
          ...(encodedScene as Record<string, unknown>),
          steps: [{ afterMs: 2_000 }],
        }),
      ).toThrowError("Expected at least one feed snapshot");
    }
  });

  it("covers every card kind, four generic fallbacks, and the misclassified delete", () => {
    const scene = loadShowcaseScene("web:cards");
    const cardKinds = {
      "cards-deploy": "zerops_deploy",
      "cards-verify": "zerops_verify",
      "cards-import": "zerops_import",
      "cards-mount": "zerops_mount",
      "cards-subdomain": "zerops_subdomain",
      "cards-plan": "zerops_workflow",
      "cards-error": "zerops_deploy",
    } as const;

    for (const [activityId, toolName] of Object.entries(cardKinds)) {
      const data = activityData(scene, activityId);
      expect(decodeActivityResult(data.zerops)).toMatchObject({
        toolName,
      });
    }

    const malformed = decodeActivityResult(activityData(scene, "cards-malformed").zerops);
    const overCap = decodeActivityResult(activityData(scene, "cards-over-cap").zerops);
    const running = decodeActivityResult(activityData(scene, "cards-running").zerops);
    const ordinary = activityData(scene, "cards-command");

    expect(malformed).toMatchObject({ resultText: "not json" });
    expect(overCap).toEqual({ toolName: "zerops_deploy", truncated: true });
    expect(running).toEqual({ toolName: "zerops_import" });
    expect(ordinary.zerops).toBeUndefined();

    const misclassified = activityData(scene, "cards-delete");
    expect(misclassified.zerops).toEqual({
      toolName: "zerops_delete",
      resultText: '{"status":"DELETED"}',
    });
    const deleteActivity = Object.values(scene.threadActivities)
      .flat()
      .find(({ id }) => id === "cards-delete");
    expect(
      Predicate.isObject(deleteActivity?.payload) &&
        !Array.isArray(deleteActivity.payload) &&
        (deleteActivity.payload as Record<string, unknown>).itemType,
    ).toBe("file_change");

    for (const activity of Object.values(scene.threadActivities).flat()) {
      const payload =
        Predicate.isObject(activity.payload) && !Array.isArray(activity.payload)
          ? (activity.payload as Record<string, unknown>)
          : undefined;
      const data =
        Predicate.isObject(payload?.data) && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : undefined;
      if (data !== undefined && Object.hasOwn(data, "zerops")) {
        expect(() => decodeActivityResult(data.zerops)).not.toThrow();
      }
    }
  });
});
