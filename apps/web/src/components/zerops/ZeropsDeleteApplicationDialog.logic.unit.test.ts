import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { HqEnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  applicationDeletionHold,
  applicationDeletionTarget,
  lastMateDeletionTarget,
} from "./ZeropsDeleteApplicationDialog.logic.ts";

function placed(id: string, name: string, kind: "mate" | "stage"): ZeropsProject {
  return {
    id,
    name,
    status: "ACTIVE",
    tagList: [],
    hq: { appId: "app-bakery", appName: "bakery", kind, mate: null },
  };
}

// witness: apps/web/src/components/zerops/ZeropsDeleteApplicationDialog.logic.ts | role === "prod" && project === undefined && branch !== undefined → role === "prod" && project !== undefined && branch !== undefined
it("MN7: Deleting a project deletes its stages' Zerops projects and keeps its productions'; a Git-branch production has no Zerops project and is listed as staying, also with the last Mate", () => {
  expect(
    applicationDeletionTarget({
      groupId: "app-bakery",
      name: "bakery",
      environments: [
        { role: "stage", project: { id: "Z_STAGE", name: "bakery-stage" } },
        { role: "prod", project: { id: "Z_PROD", name: "bakery-live" } },
        { role: "prod", project: undefined, branch: "release" },
        { role: "dev", project: { id: "Z_MATE", name: "bakery-rye" } },
      ],
    }),
  ).toEqual({
    appId: "app-bakery",
    name: "bakery",
    stages: [{ projectId: "Z_STAGE", name: "bakery-stage" }],
    productions: [{ name: "bakery-live" }, { name: "release", branch: "release" }],
  });

  expect(
    lastMateDeletionTarget(
      [placed("Z_MATE", "bakery-rye", "mate"), placed("Z_STAGE", "bakery-stage", "stage")],
      {
        id: "app-bakery",
        name: "bakery",
        environments: [
          {
            id: HqEnvironmentId.make("env-release"),
            target: { kind: "git", branch: "release", delivery: "direct" },
            tier: "production",
            name: "Production",
            sources: ["release"],
            order: 1,
            keyHeld: false,
            keyInvalid: false,
            birth: null,
            release: null,
            jobs: [],
          },
        ],
      },
    ),
  ).toEqual({
    appId: "app-bakery",
    name: "bakery",
    stages: [{ projectId: "Z_STAGE", name: "bakery-stage" }],
    productions: [{ name: "release", branch: "release" }],
  });
});

// witness: apps/web/src/components/zerops/ZeropsDeleteApplicationDialog.logic.ts | placement.appId === appId && HOLDING_KINDS.has(placement.kind) → placement.appId === appId && !HOLDING_KINDS.has(placement.kind)
it("MN23: A project deleted with its last Mate starts only once HQ's structure holds no Mate or plain project in it; breaks: HQ refuses the project's deletion (app_has_mate) while its Mate is still being deleted, and the person has to delete it again", () => {
  const at = "2026-11-22T10:00:00.000Z";
  const deletion = {
    id: "op-1",
    kind: "mate_deletion",
    phase: "delete_requested",
    at,
    acceptedAt: at,
  };
  const inBakery = (kind: "mate" | "devstage" | "stage" | "plain", operation?: object) =>
    ({
      appId: "app-bakery",
      appName: "bakery",
      kind,
      mate: null,
      ...(operation && { operation }),
    }) as HqPlacement;
  const placed = (...placements: ReadonlyArray<HqPlacement>) =>
    new Map(placements.map((placement, i) => [`p${i}`, placement]));
  const otherApp: HqPlacement = { appId: "app-mill", appName: "mill", kind: "mate", mate: null };
  const cases: ReadonlyArray<
    [string, ReadonlyMap<string, HqPlacement> | null, "free" | "waits" | "refused"]
  > = [
    ["structure unread", null, "waits"],
    ["only its stage left", placed(inBakery("stage"), otherApp), "free"],
    ["its Mate stands", placed(inBakery("mate"), inBakery("stage")), "refused"],
    ["its dev/stage Mate stands", placed(inBakery("devstage")), "refused"],
    ["its plain project stands", placed(inBakery("plain")), "refused"],
    ["HQ deletes its Mate", placed(inBakery("mate", deletion)), "waits"],
    [
      "HQ's deletion of its Mate failed",
      placed(
        inBakery("mate", {
          ...deletion,
          failure: { code: "zerops_refused", zeropsCode: "projectDeleteFailed" },
        }),
      ),
      "refused",
    ],
  ];
  for (const [state, placements, expected] of cases) {
    const hold = applicationDeletionHold(placements, "app-bakery");
    const read = hold === undefined ? "free" : hold.failed ? "refused" : "waits";
    expect({ state, read }).toEqual({ state, read: expected });
  }
});
