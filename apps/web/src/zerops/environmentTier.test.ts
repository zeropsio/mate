import type { CanonicalHqStructure } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { environmentTierOf } from "./environmentTier";

const structure = {
  apps: [
    {
      id: "app-1",
      name: "Shop",
      environments: [
        { tier: "production", target: { kind: "zerops", projectId: "p-prod" } },
        { tier: "stage", target: { kind: "zerops", projectId: "p-stage" } },
        { tier: "stage", target: { kind: "git" } },
      ],
    },
    { id: "app-2", name: "Blog", environments: { refused: "Not yours" } },
  ],
} as unknown as CanonicalHqStructure;

describe("environmentTierOf — whether a project is an application's stage or production", () => {
  it.each([
    { name: "production", projectId: "p-prod", want: "production" },
    { name: "a stage", projectId: "p-stage", want: "stage" },
    { name: "a Mate's own project", projectId: "p-mate", want: null },
  ])("$name", ({ projectId, want }) => {
    expect(environmentTierOf(structure, projectId)).toBe(want);
  });

  it("nothing while HQ's structure is not read", () => {
    expect(environmentTierOf(null, "p-prod")).toBeNull();
  });
});
