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

/** A Mate the platform minted and nothing has lowered yet. */
const MATE_TOKEN: ZeropsIntegrationToken = {
  id: "tok-mate",
  name: "zcp-Aurora - dev",
  projects: [{ projectId: DEV, roleCode: "ADMIN" }],
};
/** The same Mate after `secure-container-token` (guide 0.2). */
const LOWERED_MATE_TOKEN: ZeropsIntegrationToken = {
  ...MATE_TOKEN,
  projects: [{ projectId: DEV, roleCode: "BASIC_USER" }],
};
const DEPLOY_TOKEN: ZeropsIntegrationToken = {
  id: "tok-deploy",
  name: "gitea-deploy-aurora-prod",
  projects: [{ projectId: PROD, roleCode: "ADMIN" }],
};
const OWNER_TOKEN: ZeropsIntegrationToken = { id: "tok-owner", name: "mate-demo-owner" };

describe("findMateIntegrationToken", () => {
  it.each([
    { name: "as the platform minted it", token: MATE_TOKEN },
    { name: "after it has been lowered", token: LOWERED_MATE_TOKEN },
  ])("finds the container's own token $name", ({ token }) => {
    // Both grants are a Mate: the platform mints ADMIN and 0.2 rewrites it to
    // BASIC_USER, so a search that knew only one of them would lose every
    // Mate at exactly the moment it had been secured.
    expect(findMateIntegrationToken([OWNER_TOKEN, token, DEPLOY_TOKEN], DEV)?.id).toBe("tok-mate");
  });

  it("does not mistake a sibling's read grant for the Mate that lives there", () => {
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    };
    expect(findMateIntegrationToken([widened], PROD)).toBeUndefined();
  });

  it("does not mistake a deploy token scoped to one project for a Mate's", () => {
    // Identical by grant; only the platform's zcp- name tells them apart.
    expect(findMateIntegrationToken([DEPLOY_TOKEN], PROD)).toBeUndefined();
  });

  it("does not mistake another project's Mate for this one's", () => {
    expect(findMateIntegrationToken([MATE_TOKEN], PROD)).toBeUndefined();
  });

  it("still finds the token after it has been widened to the group", () => {
    // The match is "writes this project", never "grants only it" — otherwise
    // this module could widen a token and then lose it.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
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
  it("writes its own project and reads the rest", () => {
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [DEV, PROD, STAGE] })).toEqual([
      { projectId: DEV, roleCode: "BASIC_USER" },
      { projectId: PROD, roleCode: "READ_ONLY" },
      { projectId: STAGE, roleCode: "READ_ONLY" },
    ]);
  });

  it("lowers a solo Mate too", () => {
    // A Mate with no siblings is still a shell holding project ADMIN until
    // this runs; being alone in its group is not a reason to keep it.
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [DEV] })).toEqual([
      { projectId: DEV, roleCode: "BASIC_USER" },
    ]);
  });

  it("never takes write away from the project the Mate lives in", () => {
    // A group edit that took write access away from the project the Mate lives
    // in would end its ability to work at all.
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [PROD] })[0]).toEqual({
      projectId: DEV,
      roleCode: "BASIC_USER",
    });
  });

  it("says the same thing whatever order the group arrives in", () => {
    expect(buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [STAGE, PROD] })).toEqual(
      buildGroupGrants({ selfProjectId: DEV, groupProjectIds: [PROD, STAGE, PROD] }),
    );
  });
});

describe("planGroupReach", () => {
  it("widens a Mate that cannot yet see its group, and lowers it while it is there", () => {
    expect(
      planGroupReach({ token: MATE_TOKEN, selfProjectId: DEV, groupProjectIds: [DEV, PROD] }),
    ).toEqual({
      tokenId: "tok-mate",
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    });
  });

  it("plans a write for a solo Mate the platform minted with ADMIN", () => {
    // The whole of 0.2 for an account that has never grouped anything: one
    // grant, lowered in place, with the token string unchanged.
    expect(
      planGroupReach({ token: MATE_TOKEN, selfProjectId: DEV, groupProjectIds: [DEV] }),
    ).toEqual({
      tokenId: "tok-mate",
      projects: [{ projectId: DEV, roleCode: "BASIC_USER" }],
    });
  });

  it("plans nothing for a solo Mate already lowered", () => {
    expect(
      planGroupReach({ token: LOWERED_MATE_TOKEN, selfProjectId: DEV, groupProjectIds: [DEV] }),
    ).toBeUndefined();
  });

  it("writes nothing when the token already reaches exactly its group", () => {
    // Reconciling on a screen load must not be a write.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: DEV, roleCode: "BASIC_USER" },
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
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: STAGE, roleCode: "READ_ONLY" },
      ],
    };
    expect(
      planGroupReach({ token: widened, selfProjectId: DEV, groupProjectIds: [DEV, PROD] })
        ?.projects,
    ).toEqual([
      { projectId: DEV, roleCode: "BASIC_USER" },
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
      { projectId: DEV, roleCode: "BASIC_USER" },
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
          { projectId: DEV, roleCode: "BASIC_USER" },
          { projectId: PROD, roleCode: "READ_ONLY" },
        ],
      },
      {
        tokenId: "tok-other",
        name: "zcp-Beviro - dev",
        projects: [{ projectId: "b-dev", roleCode: "BASIC_USER" }],
      },
    ]);
  });

  it("writes nothing for an account already reconciled", () => {
    // The whole reason this can run on every screen read.
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
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
