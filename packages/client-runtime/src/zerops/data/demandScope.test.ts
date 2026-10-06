import { describe, expect, it } from "@effect/vitest";
import { planZeropsInterest } from "./runtime.ts";
import { project } from "./__fixtures__/index.ts";

const opened = project("opened");
describe("visible project demand", () => {
  it.each(["project-inventory", "project-topology"] as const)(
    "a project's %s reads nothing of its own: its services are the account store's",
    (kind) => {
      expect(planZeropsInterest({ kind, project: opened })).toEqual({
        registrations: [],
        directReads: [],
      });
    },
  );
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
