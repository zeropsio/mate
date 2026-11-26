import { expect, it } from "vite-plus/test";

import { projectDeleteOnOverview } from "./projects/emptyApps.logic";

// witness: apps/web/src/components/zerops/projects/emptyApps.logic.ts | mayDelete: offer !== "refused" → mayDelete: true
it("MN+1: Overview offers a project's Delete where no Mate is in it or coming, pressable once HQ allows deleting the project, drawn and waiting while HQ has not said, and absent where HQ refuses, whatever HQ says the project holds; breaks: a project whose contents HQ has not described has no Delete on Overview while the menu offers it", () => {
  const withoutMate = [
    { environments: [{ role: "stage" }], pending: [] },
    { environments: [], pending: [] },
    { environments: [{ role: "production" }], pending: [] },
  ];
  for (const group of withoutMate) {
    expect(projectDeleteOnOverview(group, "allowed")).toBe("pressable");
    expect(projectDeleteOnOverview(group, "refused")).toBeUndefined();
    expect(projectDeleteOnOverview(group, "unknown")).toBe("waits");
  }

  const withMate = [
    { environments: [{ role: "dev" }], pending: [] },
    { environments: [], pending: [{ kind: "mate" }] },
  ];
  for (const group of withMate) {
    expect(projectDeleteOnOverview(group, "allowed")).toBeUndefined();
    expect(projectDeleteOnOverview(group, "refused")).toBeUndefined();
    expect(projectDeleteOnOverview(group, "unknown")).toBeUndefined();
  }
});
