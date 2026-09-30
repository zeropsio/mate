import { afterEach, describe, expect, it } from "vite-plus/test";

import { useSetUpEnvironment } from "./setUpEnvironment";

afterEach(() => {
  useSetUpEnvironment.setState({ asked: null });
});

describe("useSetUpEnvironment — a stage or a production asked for from the left menu", () => {
  it.each([
    { tier: "stage", role: "stage" },
    { tier: "production", role: "prod" },
  ] as const)("hands the projects page the $tier's form once", ({ tier, role }) => {
    useSetUpEnvironment.getState().ask("grp-a", tier);
    expect(useSetUpEnvironment.getState().take()).toEqual({ groupId: "grp-a", role });
    // Taken, it is gone: the form opens once per ask, never again on the next visit.
    expect(useSetUpEnvironment.getState().take()).toBeNull();
  });

  it("keeps only the last ask", () => {
    useSetUpEnvironment.getState().ask("grp-a", "stage");
    useSetUpEnvironment.getState().ask("grp-b", "production");
    expect(useSetUpEnvironment.getState().take()).toEqual({ groupId: "grp-b", role: "prod" });
  });
});
