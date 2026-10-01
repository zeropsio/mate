import { describe, expect, it } from "vite-plus/test";

import {
  buildGroupGrants,
  findMateIntegrationToken,
  planAccountGroupReach,
  makeTokenWriteLock,
  planGroupReach,
  writeTokenProjectsFresh,
  type TokenWriteLocks,
  type ZeropsGroupReachWrite,
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

describe("writeTokenProjectsFresh", () => {
  const grant = (projectId: string) => ({ projectId, roleCode: "BASIC_USER" as const });
  /** Wants PROD on every token, keeping whatever it holds. */
  const wantProd = (tokens: ReadonlyArray<ZeropsIntegrationToken>) =>
    tokens.flatMap((token) =>
      (token.projects ?? []).some((project) => project.projectId === PROD)
        ? []
        : [
            {
              tokenId: token.id,
              name: token.name,
              projects: [...(token.projects ?? []), grant(PROD)],
            },
          ],
    );

  it("writes from the list read under the token's lock, never from an older one", async () => {
    // Between the read that found the token and the read under its lock, another writer gave
    // it STAGE: the write keeps STAGE, as the platform holds it now.
    const answers: ReadonlyArray<ReadonlyArray<ZeropsIntegrationToken>> = [
      [{ id: "tok-a", name: "a", roleCode: "NO_ACCESS", projects: [grant(DEV)] }],
      [{ id: "tok-a", name: "a", roleCode: "READ_ONLY", projects: [grant(DEV), grant(STAGE)] }],
    ];
    let reads = 0;
    const held: string[] = [];
    const written: Array<ZeropsGroupReachWrite & { readonly roleCode?: string | undefined }> = [];
    const count = await writeTokenProjectsFresh({
      read: async () => answers[Math.min(reads++, answers.length - 1)]!,
      plan: wantProd,
      hold: (tokenId, run) => {
        held.push(tokenId);
        return run();
      },
      write: async (write) => {
        written.push(write);
      },
    });

    expect(count).toBe(1);
    expect(held).toEqual(["tok-a"]);
    // As planned, no more: a Mate's token is lowered to no org role, whatever it held.
    expect(written).toEqual([
      { tokenId: "tok-a", name: "a", projects: [grant(DEV), grant(STAGE), grant(PROD)] },
    ]);
  });

  it("writes nothing for a token another writer already brought where it should be", async () => {
    const answers: ReadonlyArray<ReadonlyArray<ZeropsIntegrationToken>> = [
      [{ id: "tok-a", name: "a", projects: [grant(DEV)] }],
      [{ id: "tok-a", name: "a", projects: [grant(DEV), grant(PROD)] }],
    ];
    let reads = 0;
    let writes = 0;
    const count = await writeTokenProjectsFresh({
      read: async () => answers[Math.min(reads++, answers.length - 1)]!,
      plan: wantProd,
      write: async () => {
        writes += 1;
      },
    });
    expect([count, writes]).toEqual([0, 0]);
  });

  it("writes no more than its first plan asked for, whatever the platform answers", async () => {
    let writes = 0;
    await writeTokenProjectsFresh({
      read: async () => [{ id: "tok-a", name: "a", projects: [] }],
      plan: (tokens) =>
        tokens.map((token) => ({ tokenId: token.id, name: token.name, projects: [] })),
      write: async () => {
        writes += 1;
      },
    });
    expect(writes).toBe(1);
  });
});

describe("writeTokenProjectsFresh with a write the platform refuses", () => {
  it("still writes the other tokens, then fails so its caller backs off", async () => {
    let held: ReadonlyArray<ZeropsIntegrationToken> = [
      { id: "tok-a", name: "a", projects: [] },
      { id: "tok-b", name: "b", projects: [] },
    ];
    const attempts: string[] = [];
    const run = writeTokenProjectsFresh({
      read: async () => held,
      plan: (tokens) =>
        tokens
          .filter((token) => (token.projects ?? []).length === 0)
          .map((token) => ({
            tokenId: token.id,
            name: token.name,
            projects: [{ projectId: DEV, roleCode: "BASIC_USER" as const }],
          })),
      write: async (write) => {
        attempts.push(write.tokenId);
        if (write.tokenId === "tok-a") throw new Error("refused");
        held = held.map((token) =>
          token.id === write.tokenId ? { ...token, projects: write.projects } : token,
        );
      },
    });
    await expect(run).rejects.toThrow("refused");
    expect(attempts).toEqual(["tok-a", "tok-b"]);
  });
});

describe("makeTokenWriteLock", () => {
  /** The browser's locks: one holder of a name at a time, across every page that asks. */
  const browserLocks = (): TokenWriteLocks & { readonly names: string[] } => {
    const chains = new Map<string, Promise<unknown>>();
    const names: string[] = [];
    return {
      names,
      request: <T>(name: string, hold: () => Promise<T>) => {
        names.push(name);
        const next = (chains.get(name) ?? Promise.resolve()).then(hold);
        chains.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    };
  };

  it("holds one token's read-then-write at a time, across two tabs under the browser's lock", async () => {
    const locks = browserLocks();
    // Two tabs: each its own page queue, one browser.
    const [tabA, tabB] = [makeTokenWriteLock(locks), makeTokenWriteLock(locks)];
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = tabA("tok-a", async () => {
      order.push("first in");
      await gate;
      order.push("first out");
    });
    const second = tabB("tok-a", async () => {
      order.push("second in");
    });
    const other = tabB("tok-b", async () => {
      order.push("other in");
    });
    await other;
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first in", "other in", "first out", "second in"]);
    expect(locks.names.toSorted()).toEqual([
      "mate:token:tok-a",
      "mate:token:tok-a",
      "mate:token:tok-b",
    ]);
  });

  it("lets go of a hold that outlives its bound, failing it, so the next writer goes on", async () => {
    const hold = makeTokenWriteLock(browserLocks(), { timeoutMs: 10 });
    const stuck = hold("tok-a", () => new Promise<void>(() => undefined));
    const next = hold("tok-a", async () => "next");
    await expect(stuck).rejects.toThrow(/tok-a/);
    await expect(next).resolves.toBe("next");
  });
});
