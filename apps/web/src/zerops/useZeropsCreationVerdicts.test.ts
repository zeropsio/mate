import { describe, expect, it } from "vite-plus/test";

import { creationVerdictTargets } from "./useZeropsCreationVerdicts";

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
