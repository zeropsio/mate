import { describe, expect, it } from "vite-plus/test";

import { creationVerdictTargets, settledCreations } from "./useProjectCreations";

describe("creationVerdictTargets", () => {
  it("names every project still on its way up, once each", () => {
    expect(
      creationVerdictTargets([
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "b", name: "b", status: "NEW" } },
        { project: { id: "c", name: "c", status: "ACTIVE" } },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("names nobody once every project has landed", () => {
    expect(creationVerdictTargets([{ project: { id: "a", name: "a", status: "ACTIVE" } }])).toEqual(
      [],
    );
  });
});

describe("settledCreations", () => {
  it("keeps the creations the platform settled, never one still on its way", () => {
    const settled = settledCreations({
      p1: { processId: "c1", status: "RUNNING", error: null },
      p2: { processId: "c2", status: "FAILED", error: { code: "x", message: "Broke" } },
      p3: { processId: "c3", status: "FINISHED", error: null },
    });
    expect([...settled.keys()]).toEqual(["p2", "p3"]);
  });
});
