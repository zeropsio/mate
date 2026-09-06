import { describe, expect, it } from "vite-plus/test";

import {
  formatGroupFacts,
  MATE_ENVIRONMENTS_ENV_KEY,
  MATE_GROUP_ENV_KEY,
  planGroupFacts,
  type ZeropsGroupFactEnvironment,
} from "./groupFacts.ts";

const DEV: ZeropsGroupFactEnvironment = {
  role: "dev",
  name: "Aurora - dev",
  projectId: "dev-1",
  services: [{ hostname: "zcp", type: "zcp@1" }],
};
const PROD: ZeropsGroupFactEnvironment = {
  role: "prod",
  name: "Aurora - production",
  projectId: "prod-1",
  services: [
    { hostname: "db", type: "postgresql:single@18" },
    { hostname: "app", type: "nodejs@22" },
  ],
};
const STAGE: ZeropsGroupFactEnvironment = {
  role: "stage",
  name: "Aurora - stage",
  projectId: "stage-1",
  services: [],
};

describe("formatGroupFacts", () => {
  it("tells a Mate about production, and does not tell it about itself", () => {
    const facts = formatGroupFacts({
      groupName: "Aurora",
      environments: [DEV, PROD],
      selfProjectId: "dev-1",
    });

    expect(facts[MATE_GROUP_ENV_KEY]).toBe("Aurora");
    expect(JSON.parse(facts[MATE_ENVIRONMENTS_ENV_KEY] ?? "[]")).toEqual([
      {
        role: "prod",
        name: "Aurora - production",
        projectId: "prod-1",
        // Sorted, so an unchanged group never rewrites itself.
        services: [
          { hostname: "app", type: "nodejs@22" },
          { hostname: "db", type: "postgresql:single@18" },
        ],
      },
    ]);
  });

  it("says nothing at all about a group of one", () => {
    // An empty list would read as "production is absent", which is a different
    // claim from "there is nothing to say".
    expect(
      formatGroupFacts({ groupName: "Aurora", environments: [DEV], selfProjectId: "dev-1" }),
    ).toEqual({});
  });

  it("carries no credential", () => {
    const facts = formatGroupFacts({
      groupName: "Aurora",
      environments: [DEV, PROD],
      selfProjectId: "dev-1",
    });
    expect(Object.keys(facts)).toEqual([MATE_GROUP_ENV_KEY, MATE_ENVIRONMENTS_ENV_KEY]);
  });

  it("orders the group the way the group is ordered", () => {
    const facts = formatGroupFacts({
      environments: [PROD, STAGE, DEV],
      selfProjectId: "dev-1",
    });
    expect(
      (JSON.parse(facts[MATE_ENVIRONMENTS_ENV_KEY] ?? "[]") as ReadonlyArray<{ role: string }>).map(
        (entry) => entry.role,
      ),
    ).toEqual(["stage", "prod"]);
  });

  it("names no group when nothing has named it", () => {
    const facts = formatGroupFacts({ environments: [DEV, PROD], selfProjectId: "dev-1" });
    expect(facts).not.toHaveProperty(MATE_GROUP_ENV_KEY);
    expect(facts).toHaveProperty(MATE_ENVIRONMENTS_ENV_KEY);
  });
});

describe("planGroupFacts", () => {
  const facts = formatGroupFacts({
    groupName: "Aurora",
    environments: [DEV, PROD],
    selfProjectId: "dev-1",
  });

  it("writes both keys to a Mate that has neither", () => {
    const plan = planGroupFacts({ facts, current: {} });
    expect(plan.write).toEqual([MATE_GROUP_ENV_KEY, MATE_ENVIRONMENTS_ENV_KEY]);
    expect(plan.restart).toBe(true);
  });

  it("writes nothing, and does not restart, over an unchanged group", () => {
    expect(planGroupFacts({ facts, current: { ...facts } })).toEqual({
      write: [],
      values: {},
      restart: false,
    });
  });

  it("writes only what moved when production gains a service", () => {
    const grown = formatGroupFacts({
      groupName: "Aurora",
      environments: [
        DEV,
        { ...PROD, services: [...PROD.services, { hostname: "cache", type: "valkey@7" }] },
      ],
      selfProjectId: "dev-1",
    });

    const plan = planGroupFacts({ facts: grown, current: { ...facts } });
    expect(plan.write).toEqual([MATE_ENVIRONMENTS_ENV_KEY]);
    expect(plan.restart).toBe(true);
  });
});
