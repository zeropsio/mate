import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { HqEnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
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
