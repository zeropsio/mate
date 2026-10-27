import { describe, expect, it } from "@effect/vitest";

import { registryFromHq } from "./registry.ts";

describe("registryFromHq", () => {
  it("is HQ's structure, each application a group under its own id", () => {
    expect(
      registryFromHq({
        // A Mate in no application is in no group.
        ungrouped: [{ projectId: "p5", name: "scratch", mate: { face: "sky:flower" } }],
        apps: [
          {
            id: "app-1",
            name: "Acme CRM",
            projects: [
              { projectId: "p1", name: "Acme CRM - Vera", kind: "mate", mate: null },
              { projectId: "p2", name: "acme-stage", kind: "stage", mate: null },
              { projectId: "p3", name: "acme", kind: "production", mate: null },
              // A kind this build does not know places nothing.
              { projectId: "p4", name: "later", kind: "preview", mate: null },
            ],
          },
          { id: "app-2", name: "Empty", projects: [] },
        ],
      }),
    ).toEqual({
      groups: [
        {
          groupId: "app-1",
          name: "Acme CRM",
          projects: [
            { projectId: "p1", kind: "mate" },
            { projectId: "p2", kind: "stage" },
            { projectId: "p3", kind: "production" },
          ],
        },
        { groupId: "app-2", name: "Empty", projects: [] },
      ],
    });
  });
});

const placements = [
  { projectId: "stage", kind: "stage" },
  { projectId: "prod", kind: "production" },
];
it.each([
  { state: "absent", environments: undefined, expected: placements },
  { state: "refused", environments: { refused: "changes_not_seen" }, expected: placements },
  { state: "empty", environments: [], expected: placements },
  {
    state: "partial",
    environments: [
      {
        projectId: "stage",
        tier: "stage" as const,
        name: "Stage",
        sources: ["main"],
        order: 1,
        keyHeld: true,
        keyInvalid: false,
        jobs: [],
      },
    ],
    expected: [
      { projectId: "prod", kind: "production" },
      { projectId: "stage", kind: "stage" },
    ],
  },
])(
  "Registry placements survive $state environments unless a decoded target replaces them.",
  ({ environments, expected }) => {
    expect(
      registryFromHq({
        ungrouped: [],
        apps: [
          {
            id: "shop",
            name: "Shop",
            ...(environments === undefined ? {} : { environments }),
            projects: [
              { projectId: "stage", name: "Stage", kind: "stage", mate: null },
              { projectId: "prod", name: "Production", kind: "production", mate: null },
            ],
          },
        ],
      }).groups[0]?.projects,
    ).toEqual(expected);
  },
);
