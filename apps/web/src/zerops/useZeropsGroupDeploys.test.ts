import { describe, expect, it } from "vite-plus/test";

import { readGroupDeploysKey, type ZeropsDeployGroup } from "./useZeropsGroupDeploys";

const GROUP: ZeropsDeployGroup = {
  groupId: "g1",
  slug: "harbor",
  projects: [
    {
      projectId: "p1",
      name: "Harbor - Ada",
      services: [{ serviceId: "s1", hostname: "appdev" }],
    },
  ],
};

describe("readGroupDeploysKey", () => {
  it("is stable while nothing the reads depend on has changed", () => {
    expect(readGroupDeploysKey([GROUP], "https://gitea", 0)).toBe(
      readGroupDeploysKey([GROUP], "https://gitea", 0),
    );
  });

  it("moves when a verb the person ran has settled", () => {
    // A merge empties the pull-request row immediately, because the forge hook
    // is told. The deploy state — "N changes are merged and not live", what
    // each environment runs — was on a 60s clock alone, so the line that says
    // what is waiting to go live stood still for up to a minute after the
    // person merged (measured on the test account, 2026-09-21).
    expect(readGroupDeploysKey([GROUP], "https://gitea", 1)).not.toBe(
      readGroupDeploysKey([GROUP], "https://gitea", 0),
    );
  });

  it("moves when a project's role appears, which is what fills a tier", () => {
    const withRole: ZeropsDeployGroup = {
      ...GROUP,
      projects: [{ ...GROUP.projects[0]!, role: "stage" }],
    };
    expect(readGroupDeploysKey([withRole], "https://gitea", 0)).not.toBe(
      readGroupDeploysKey([GROUP], "https://gitea", 0),
    );
  });
});
