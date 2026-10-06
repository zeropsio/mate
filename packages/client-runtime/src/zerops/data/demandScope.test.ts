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
