import { describe, expect, it } from "@effect/vitest";
import { planZeropsInterest } from "./runtime.ts";
import { project } from "./__fixtures__/index.ts";

const opened = project("opened");
describe("visible project demand", () => {
  it.each(["project-inventory", "project-topology"] as const)(
    "narrows every %s membership and update registration to the opened project",
    (kind) => {
      const plan = planZeropsInterest({ kind, project: opened });
      for (const { descriptor } of plan.registrations) {
        const scope = descriptor.kind === "query-membership" ? descriptor.query : descriptor;
        expect(scope).toMatchObject({ project: opened });
      }
    },
  );
  it("bootstraps opened services with one direct project service list", () => {
    expect(planZeropsInterest({ kind: "project-inventory", project: opened }).directReads).toEqual([
      {
        kind: "query",
        descriptor: { kind: "services-of-project", project: opened, schemaVersion: 1 },
      },
    ]);
  });
});

it("restricts the project's variables to the opened service IDs", () => {
  const serviceIds = ["mate", "app"];
  const plan = planZeropsInterest({ kind: "project-variables", project: opened, serviceIds });
  expect(plan.registrations).toHaveLength(2);
  for (const { descriptor } of plan.registrations) {
    expect(descriptor.kind === "table-list" ? descriptor.query : descriptor).toMatchObject({
      serviceIds,
    });
  }
});
