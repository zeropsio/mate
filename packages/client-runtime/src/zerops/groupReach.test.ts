import { describe, expect, it } from "vite-plus/test";

import {
  buildGroupGrants,
  findMateIntegrationToken,
  planAccountGroupReach,
  planGroupReach,
  type ZeropsIntegrationToken,
} from "./groupReach.ts";

const DEV = "dev-1";
const PROD = "prod-1";
const STAGE = "stage-1";

const MATE_TOKEN: ZeropsIntegrationToken = {
  id: "tok-mate",
  name: "zcp-Aurora - dev",
  projects: [{ projectId: DEV, roleCode: "ADMIN" }],
};
const DEPLOY_TOKEN: ZeropsIntegrationToken = {
  id: "tok-deploy",
  name: "gitea-deploy-aurora-prod",
  projects: [{ projectId: PROD, roleCode: "ADMIN" }],
};
const OWNER_TOKEN: ZeropsIntegrationToken = { id: "tok-owner", name: "mate-demo-owner" };

describe("findMateIntegrationToken", () => {
  it("finds the container's own token among the account's", () => {
    expect(findMateIntegrationToken([OWNER_TOKEN, MATE_TOKEN, DEPLOY_TOKEN], DEV)?.id).toBe(
      "tok-mate",
    );
  });

  it("does not mistake a deploy token scoped to one project for a Mate's", () => {
    // Identical by grant; only the platform's zcp- name tells them apart.
    expect(findMateIntegrationToken([DEPLOY_TOKEN], PROD)).toBeUndefined();
  });

  it("does not mistake another project's Mate for this one's", () => {
    expect(findMateIntegrationToken([MATE_TOKEN], PROD)).toBeUndefined();
  });

  it("still finds the token after it has been widened to the group", () => {
    // The match is "grants ADMIN on this project", never "grants only it" —
    // otherwise this module could widen a token and then lose it.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    };
    expect(findMateIntegrationToken([widened], DEV)?.id).toBe("tok-mate");
  });

  it("finds nothing when the account has no Mate in this project", () => {
    expect(findMateIntegrationToken([], DEV)).toBeUndefined();
  });
});

describe("buildGroupGrants", () => {
  it("keeps admin on its own project and reads the rest", () => {
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [DEV, PROD, STAGE] })).toEqual([
      { projectId: DEV, roleCode: "ADMIN" },
      { projectId: PROD, roleCode: "READ_ONLY" },
      { projectId: STAGE, roleCode: "READ_ONLY" },
    ]);
  });

  it("grants a solo Mate exactly what it had", () => {
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [DEV] })).toEqual([
      { projectId: DEV, roleCode: "ADMIN" },
    ]);
  });

  it("never demotes a Mate in its own project", () => {
    // A group edit that took write access away from the project the Mate lives
    // in would end its ability to work at all.
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [PROD] })[0]).toEqual({
      projectId: DEV,
      roleCode: "ADMIN",
    });
  });

  it("says the same thing whatever order the group arrives in", () => {
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [STAGE, PROD] })).toEqual(
      buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [PROD, STAGE, PROD] }),
    );
  });
});

describe("planGroupReach", () => {
  it("widens a Mate that cannot yet see its group", () => {
    expect(
      planGroupReach({ token: MATE_TOKEN, selfProjectId: DEV, groupProjectIds: [DEV, PROD] }),
    ).toEqual({
      tokenId: "tok-mate",
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    });
  });

  it("writes nothing when the token already reaches exactly its group", () => {
    // Reconciling on a screen load must not be a write.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: DEV, roleCode: "ADMIN" },
      ],
    };
    expect(
      planGroupReach({ token: widened, selfProjectId: DEV, groupProjectIds: [PROD, DEV] }),
    ).toBeUndefined();
  });

  it("narrows a Mate when an environment leaves the group", () => {
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: STAGE, roleCode: "READ_ONLY" },
      ],
    };
    expect(
      planGroupReach({ token: widened, selfProjectId: DEV, groupProjectIds: [DEV, PROD] })
        ?.projects,
    ).toEqual([
      { projectId: DEV, roleCode: "ADMIN" },
      { projectId: PROD, roleCode: "READ_ONLY" },
    ]);
  });

  it("repairs a sibling that was granted more than it should have", () => {
    const wrong: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "ADMIN" },
      ],
    };
    expect(
      planGroupReach({ token: wrong, selfProjectId: DEV, groupProjectIds: [DEV, PROD] })?.projects,
    ).toEqual([
      { projectId: DEV, roleCode: "ADMIN" },
      { projectId: PROD, roleCode: "READ_ONLY" },
    ]);
  });
});

describe("planAccountGroupReach", () => {
  const tokens: ReadonlyArray<ZeropsIntegrationToken> = [
    MATE_TOKEN,
    DEPLOY_TOKEN,
    OWNER_TOKEN,
    {
      id: "tok-other",
      name: "zcp-Beviro - dev",
      projects: [{ projectId: "b-dev", roleCode: "ADMIN" }],
    },
  ];

  it("widens each group's Mates and leaves everything else alone", () => {
    expect(
      planAccountGroupReach({
        groups: [
          { projectIds: [DEV, PROD], mateProjectIds: [DEV] },
          { projectIds: ["b-dev"], mateProjectIds: ["b-dev"] },
        ],
        tokens,
      }),
    ).toEqual([
      {
        tokenId: "tok-mate",
        name: "zcp-Aurora - dev",
        projects: [
          { projectId: DEV, roleCode: "ADMIN" },
          { projectId: PROD, roleCode: "READ_ONLY" },
        ],
      },
    ]);
  });

  it("writes nothing for an account already reconciled", () => {
    // The whole reason this can run on every screen read.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    };
    expect(
      planAccountGroupReach({
        groups: [{ projectIds: [DEV, PROD], mateProjectIds: [DEV] }],
        tokens: [widened],
      }),
    ).toEqual([]);
  });

  it("skips a Mate whose token this client cannot find", () => {
    expect(
      planAccountGroupReach({
        groups: [{ projectIds: [DEV, PROD], mateProjectIds: [DEV] }],
        tokens: [DEPLOY_TOKEN],
      }),
    ).toEqual([]);
  });
});
