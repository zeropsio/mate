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
