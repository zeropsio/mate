import { describe, expect, it } from "vite-plus/test";

import {
  findHeldMateKey,
  newestMateKey,
  makeTokenWriteLock,
  planMateKey,
  findWiderMateKey,
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

// Which tokens are a Mate's key: the one key found, with no container's age to tell keys apart.
describe("findHeldMateKey — which tokens are a Mate's key", () => {
  /** The key of the Mate in `projectId` among `tokens`, where it is the only one. */
  const mateKeyIn = (tokens: ReadonlyArray<ZeropsIntegrationToken>, projectId: string) =>
    findHeldMateKey(tokens, projectId, undefined);

  it.each([
    { name: "as the platform minted it", token: MATE_TOKEN },
    { name: "after it has been lowered", token: LOWERED_MATE_TOKEN },
  ])("finds the container's own token $name", ({ token }) => {
    // Both grants are a Mate: the platform mints ADMIN and 0.2 rewrites it to
    // BASIC_USER, so a search that knew only one of them would lose every
    // Mate at exactly the moment it had been secured.
    expect(mateKeyIn([OWNER_TOKEN, token, DEPLOY_TOKEN], DEV)?.id).toBe("tok-mate");
  });

  it("does not mistake a sibling's read grant for the Mate that lives there", () => {
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    };
    expect(mateKeyIn([widened], PROD)).toBeUndefined();
  });

  it("does not mistake a deploy token scoped to one project for a Mate's", () => {
    // Identical by grant; only the names a Mate's key comes with tell them apart.
    expect(mateKeyIn([DEPLOY_TOKEN], PROD)).toBeUndefined();
  });

  it("does not mistake another project's Mate for this one's", () => {
    expect(mateKeyIn([MATE_TOKEN], PROD)).toBeUndefined();
  });

  // An earlier client's key widened to the group is left as it is: the rule takes a key whose only
  // grant is its project, until the harden finds the key by the id its Mate enrolled with HQ.
  it("does not take a key widened to the group for the Mate's", () => {
    const widened: ZeropsIntegrationToken = {
      ...MATE_TOKEN,
      projects: [
        { projectId: DEV, roleCode: "BASIC_USER" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
    };
    expect(mateKeyIn([widened], DEV)).toBeUndefined();
  });

  it("finds nothing when the account has no Mate in this project", () => {
    expect(mateKeyIn([], DEV)).toBeUndefined();
  });
});

// Step A, A11 (the audit): a key the Zerops GUI makes with a Mate's container is named
// `zerops-zcp-zcp`, ADMIN on that one project, and the `zcp-` matcher never found it. Until the
// harden finds a key by the id its Mate enrolled with HQ, it takes the platform's two names, a key
// whose only grant is this project, made before the container — never a deploy key, nor a
// person's own token on the project.
describe("findHeldMateKey — a key the platform made, by either of its names", () => {
  const CONTAINER = "2026-10-01T10:05:00Z";
  const token = (
    id: string,
    name: string,
    projects: ZeropsIntegrationToken["projects"],
    created = "2026-10-01T10:04:58Z",
  ): ZeropsIntegrationToken => ({ id, name, roleCode: "NO_ACCESS", created, projects });
  const only = (roleCode: "ADMIN" | "BASIC_USER") => [{ projectId: DEV, roleCode }];

  it.each([
    {
      case: "the GUI's key, zerops-zcp-zcp, ADMIN on its one project",
      tokens: [token("k-gui", "zerops-zcp-zcp", only("ADMIN"))],
      want: "k-gui",
    },
    {
      case: "a press's key, zcp-<project>",
      tokens: [token("k-press", "zcp-Aurora - dev", only("BASIC_USER"))],
      want: "k-press",
    },
    {
      case: "not a deploy key on the project",
      tokens: [token("k-deploy", "deploy-aurora - stage", only("BASIC_USER"))],
      want: undefined,
    },
    {
      case: "not a person's own token on the project",
      tokens: [token("k-ci", "ci", only("ADMIN"))],
      want: undefined,
    },
    {
      case: "not a key that reaches another project too",
      tokens: [
        token("k-wide", "zerops-zcp-zcp", [
          { projectId: DEV, roleCode: "ADMIN" },
          { projectId: PROD, roleCode: "READ_ONLY" },
        ]),
      ],
      want: undefined,
    },
    {
      case: "not one made after the container",
      tokens: [token("k-late", "zerops-zcp-zcp", only("ADMIN"), "2026-10-01T10:06:00Z")],
      want: undefined,
    },
  ])("$case", ({ tokens, want }) => {
    expect(findHeldMateKey(tokens, DEV, CONTAINER)?.id).toBe(want);
  });
});

// ADR 0003: a Mate's key holds its own project and nothing this client adds beside it. The plan
// lowers a key the platform minted with ADMIN, and keeps every other grant it holds exactly as it
// is — a grant on a sibling is neither added nor taken away here.
// ADR 0003: a Mate's key reaches only its own project. The harden Finish setup runs takes off the
// READ_ONLY grants on siblings — production included — an earlier client gave a Mate's key.
describe("planMateKey", () => {
  it.each([
    {
      case: "a key the platform minted with ADMIN is lowered in place",
      projects: [{ projectId: DEV, roleCode: "ADMIN" }],
      written: [{ projectId: DEV, roleCode: "BASIC_USER" }],
    },
    {
      case: "a key that reads a sibling has it taken off",
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "READ_ONLY" },
      ],
      written: [{ projectId: DEV, roleCode: "BASIC_USER" }],
    },
    {
      case: "a key already lowered still has its siblings taken off",
      projects: [
        { projectId: PROD, roleCode: "READ_ONLY" },
        { projectId: DEV, roleCode: "BASIC_USER" },
      ],
      written: [{ projectId: DEV, roleCode: "BASIC_USER" }],
    },
    {
      case: "a key lowered and on its own project alone plans nothing",
      projects: [{ projectId: DEV, roleCode: "BASIC_USER" }],
      written: null,
    },
    // Security review 7: only a Mate's key is ever written (`mateKeyReach`).
    {
      case: "a key with no grant on its own project is left as it is",
      projects: [{ projectId: STAGE, roleCode: "READ_ONLY" }],
      written: null,
    },
    {
      case: "a key that may write a sibling is left as it is",
      projects: [
        { projectId: DEV, roleCode: "ADMIN" },
        { projectId: PROD, roleCode: "BASIC_USER" },
      ],
      written: null,
    },
  ] as const)("$case", ({ projects, written }) => {
    const token: ZeropsIntegrationToken = { ...MATE_TOKEN, projects };
    expect(planMateKey({ token, selfProjectId: DEV })).toEqual(
      written === null ? undefined : { tokenId: "tok-mate", projects: written },
    );
  });
});

// The keys an earlier client widened with READ_ONLY on siblings: found only by their Mate's
// Finish setup, which takes the extra grants off — never a deploy key, a person's token, nor a key
// that writes anything beyond its own project.
describe("findWiderMateKey — a Mate's key an earlier client widened", () => {
  const CONTAINER = "2026-09-20T10:00:00Z";
  const wide = (over: Partial<ZeropsIntegrationToken> = {}): ZeropsIntegrationToken => ({
    ...MATE_TOKEN,
    created: "2026-09-20T09:59:00Z",
    projects: [
      { projectId: DEV, roleCode: "BASIC_USER" },
      { projectId: PROD, roleCode: "READ_ONLY" },
      { projectId: STAGE, roleCode: "READ_ONLY" },
    ],
    ...over,
  });
  it.each([
    { case: "its own project and READ_ONLY siblings", token: wide(), found: true },
    {
      case: "as the Zerops GUI names it",
      token: wide({ name: "zerops-zcp-zcp" }),
      found: true,
    },
    { case: "a key on its own project alone", token: LOWERED_MATE_TOKEN, found: false },
    { case: "a deploy key", token: wide({ name: "gitea-deploy-aurora-prod" }), found: false },
    { case: "a person's token", token: wide({ name: "mate-demo-owner" }), found: false },
    {
      case: "a key that writes a sibling",
      token: wide({
        projects: [
          { projectId: DEV, roleCode: "BASIC_USER" },
          { projectId: PROD, roleCode: "ADMIN" },
        ],
      }),
      found: false,
    },
    {
      case: "a key that reads siblings and not its own project",
      token: wide({ projects: [{ projectId: PROD, roleCode: "READ_ONLY" }] }),
      found: false,
    },
    {
      case: "a key made after its container",
      token: wide({ created: "2026-09-20T11:00:00Z" }),
      found: false,
    },
  ])("$case: $found", ({ token, found }) => {
    expect(findWiderMateKey([OWNER_TOKEN, token, DEPLOY_TOKEN], DEV, CONTAINER)?.id).toBe(
      found ? token.id : undefined,
    );
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

  // Security review 7: a press reuses only a key that is its Mate's (`mateKeyReach`): its own
  // project alone, or READ_ONLY siblings its reuse takes off. A `zcp-` key that holds more
  // elsewhere is never reused — and so never stripped: the press mints a new one.
  it.each([
    {
      case: "READ_ONLY on a sibling: reused",
      grants: [{ projectId: "prod", roleCode: "READ_ONLY" as const }],
      want: "k-1",
    },
    {
      case: "a sibling it may write: never reused",
      grants: [{ projectId: "prod", roleCode: "BASIC_USER" as const }],
      want: undefined,
    },
    {
      case: "a sibling it administers: never reused",
      grants: [{ projectId: "prod", roleCode: "ADMIN" as const }],
      want: undefined,
    },
  ])("$case", ({ grants, want }) => {
    const widened = {
      ...key("k-1", "2026-10-01T09:00:00Z"),
      name: "zcp-shop",
    };
    expect(
      newestMateKey([{ ...widened, projects: [...(widened.projects ?? []), ...grants] }], "p-1")
        ?.id,
    ).toBe(want);
  });
});
