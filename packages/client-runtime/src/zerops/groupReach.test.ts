import { describe, expect, it } from "vite-plus/test";

import {
  findHeldMateKey,
  mateHardenableBy,
  mateNeedsHarden,
  findMateIntegrationToken,
  newestMateKey,
  planAccountMateKeys,
  makeTokenWriteLock,
  planMateKey,
  writeTokenProjectsFresh,
  type MateKeyWrite,
  type TokenWriteLocks,
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

// ADR 0003: a Mate's key holds its own project and nothing this client adds beside it. The plan
// lowers a key the platform minted with ADMIN, and keeps every other grant it holds exactly as it
// is — a grant on a sibling is neither added nor taken away here.
describe("planMateKey", () => {
  it.each([
    {
      case: "a key the platform minted with ADMIN is lowered in place",
      projects: [{ projectId: DEV, roleCode: "ADMIN" }],
      written: [{ projectId: DEV, roleCode: "BASIC_USER" }],
    },
    {
      case: "a key that reads a sibling keeps it, and gains nothing",
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
      written: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    },
    {
      case: "a key already lowered plans nothing, whatever else it holds",
      projects: [
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: DEV, roleCode: "BASIC_USER" },
      ],
      written: null,
    },
    {
      case: "a key with no grant on its own project is given one",
      projects: [{ projectId: STAGE, roleCode: "READ_ONLY" }],
      written: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: STAGE, roleCode: "READ_ONLY" },
      ],
    },
  ] as const)("$case", ({ projects, written }) => {
    const token: ZeropsIntegrationToken = { ...MATE_TOKEN, projects };
    expect(planMateKey({ token, selfProjectId: DEV })).toEqual(
      written === null ? undefined : { tokenId: "tok-mate", projects: written },
    );
  });
});

describe("planAccountMateKeys", () => {
  const tokens: ReadonlyArray<ZeropsIntegrationToken> = [
    MATE_TOKEN,
    DEPLOY_TOKEN,
    OWNER_TOKEN,
    {
      id: "tok-other",
      name: "zcp-Beviro - dev",
      projects: [
        { projectId: "b-dev", roleCode: "ADMIN" },
        { projectId: "b-prod", roleCode: "READ_ONLY" },
      ],
    },
  ];

  it("lowers each Mate's key, adds no sibling, and leaves every other token alone", () => {
    expect(planAccountMateKeys({ mateProjectIds: [DEV, "b-dev"], tokens })).toEqual([
      {
        tokenId: "tok-mate",
        name: "zcp-Aurora - dev",
        projects: [{ projectId: DEV, roleCode: "BASIC_USER" }],
      },
      {
        tokenId: "tok-other",
        name: "zcp-Beviro - dev",
        projects: [
          { projectId: "b-dev", roleCode: "BASIC_USER" },
          { projectId: "b-prod", roleCode: "READ_ONLY" },
        ],
      },
    ]);
  });

  it("writes nothing for an account whose keys are lowered", () => {
    // The whole reason this can run on every screen read.
    expect(planAccountMateKeys({ mateProjectIds: [DEV], tokens: [LOWERED_MATE_TOKEN] })).toEqual(
      [],
    );
  });

  it("skips a Mate whose key this client cannot find", () => {
    expect(planAccountMateKeys({ mateProjectIds: [DEV], tokens: [DEPLOY_TOKEN] })).toEqual([]);
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
    const written: Array<MateKeyWrite> = [];
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

// Two keys on one Mate — a press that raced another, a platform key beside the press's own: the
// container holds the one made before it, newest first; a key made after it is an orphan, and a
// key nothing can tell apart is never guessed at (pass 28 review).
describe("findHeldMateKey — the key a Mate's container holds", () => {
  const key = (id: string, created: string | undefined) => ({
    id,
    name: "zcp-acme",
    roleCode: "NO_ACCESS",
    ...(created === undefined ? {} : { created }),
    projects: [{ projectId: "p-1", roleCode: "BASIC_USER" as const }],
  });
  const OTHER = { ...key("k-other", "2026-10-01T10:00:00Z"), name: "deploy-acme" };
  it.each([
    { case: "no key", tokens: [OTHER], container: "2026-10-01T10:05:00Z", want: undefined },
    {
      case: "the one key",
      tokens: [key("k-1", undefined)],
      container: undefined,
      want: "k-1",
    },
    {
      case: "the newest made before its container, not the orphan made after",
      tokens: [
        key("k-old", "2026-10-01T09:00:00Z"),
        key("k-held", "2026-10-01T10:04:59Z"),
        key("k-orphan", "2026-10-01T10:06:00Z"),
      ],
      container: "2026-10-01T10:05:00Z",
      want: "k-held",
    },
    {
      case: "nothing, where its container's age is unknown",
      tokens: [key("k-a", "2026-10-01T09:00:00Z"), key("k-b", "2026-10-01T10:00:00Z")],
      container: undefined,
      want: undefined,
    },
    {
      case: "nothing, where every key came after its container",
      tokens: [key("k-a", "2026-10-01T11:00:00Z"), key("k-b", "2026-10-01T12:00:00Z")],
      container: "2026-10-01T10:05:00Z",
      want: undefined,
    },
  ])("$case", ({ tokens, container, want }) => {
    expect(findHeldMateKey(tokens, "p-1", container)?.id).toBe(want);
  });

  it("reuses the newest key where no container holds one", () => {
    expect(
      newestMateKey(
        [key("k-old", "2026-10-01T09:00:00Z"), key("k-new", "2026-10-01T10:00:00Z")],
        "p-1",
      )?.id,
    ).toBe("k-new");
  });
});

// A Mate not hardened yet — a pool-claimed one whose harden never ran, an older one — is read off
// the platform's own token list, so any browser, after a reload too, knows it (pass 28 review).
describe("mateNeedsHarden — a Mate's key still ADMIN on its own project", () => {
  const key = (roleCode: "ADMIN" | "BASIC_USER") => ({
    id: "k-1",
    name: "zcp-acme",
    projects: [
      { projectId: "p-1", roleCode },
      { projectId: "p-stage", roleCode: "READ_ONLY" as const },
    ],
  });
  it.each([
    { case: "a key at ADMIN", tokens: [key("ADMIN")], want: true },
    { case: "a key lowered", tokens: [key("BASIC_USER")], want: false },
    { case: "no key of its", tokens: [], want: false },
    {
      case: "another project's ADMIN key",
      tokens: [{ ...key("ADMIN"), projects: [{ projectId: "p-2", roleCode: "ADMIN" as const }] }],
      want: false,
    },
    // A leftover ADMIN key beside a lowered one: the container's may well be the lowered one, and
    // an older Mate is not held for a key it may not use (pass 28 review).
    {
      case: "an ADMIN key beside a lowered one",
      tokens: [key("ADMIN"), { ...key("BASIC_USER"), id: "k-2" }],
      want: false,
    },
  ])("$case: $want", ({ tokens, want }) => {
    expect(mateNeedsHarden(tokens, "p-1")).toBe(want);
  });
});

// Only who may write the key may harden it: an org owner, or the key's creator (pass 28 review).
describe("mateHardenableBy", () => {
  const admin = (createdByUser: string) => ({
    id: "k-1",
    name: "zcp-acme",
    createdByUser,
    projects: [{ projectId: "p-1", roleCode: "ADMIN" as const }],
  });
  it.each([
    {
      case: "an org owner",
      tokens: [admin("u-eva")],
      viewer: { userId: "u-zoe", roleCode: "OWNER" },
      want: true,
    },
    {
      case: "the key's creator",
      tokens: [admin("u-ada")],
      viewer: { userId: "u-ada", roleCode: "BASIC_USER" },
      want: true,
    },
    {
      case: "an admin who did not create it",
      tokens: [admin("u-eva")],
      viewer: { userId: "u-ada", roleCode: "ADMIN" },
      want: false,
    },
    {
      case: "anybody, where nothing needs it",
      tokens: [
        { ...admin("u-ada"), projects: [{ projectId: "p-1", roleCode: "BASIC_USER" as const }] },
      ],
      viewer: { userId: "u-ada", roleCode: "OWNER" },
      want: false,
    },
  ])("$case: $want", ({ tokens, viewer, want }) => {
    expect(mateHardenableBy(tokens, "p-1", viewer)).toBe(want);
  });
});
