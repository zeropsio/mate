import { describe, expect, it, vi } from "vite-plus/test";

import {
  makeTokenWriteLock,
  type TokenWriteLocks,
  type ZeropsIntegrationToken,
} from "@t3tools/client-runtime/zerops";

import { brokerGrantTokens, grantBrokerProject } from "./brokerGrant";
import { makeTokenStore } from "./__fixtures__/tokenStore";

const BROKER = {
  id: "t-2",
  name: "mate-broker",
  roleCode: "READ_ONLY",
  projects: [{ projectId: "p-gitea", roleCode: "BASIC_USER" as const }],
};

function apiFake(overrides: Record<string, unknown> = {}) {
  return {
    listIntegrationTokens: vi.fn().mockResolvedValue([{ id: "t-1", name: "zcp-fen" }, BROKER]),
    setIntegrationTokenProjects: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("grantBrokerProject", () => {
  it("adds the project to the broker's grants at BASIC_USER and keeps the rest, role included", async () => {
    const api = apiFake();
    const outcome = await grantBrokerProject({
      client: api as never,
      clientId: "org-1",
      projectId: "p-mate",
    });

    expect(outcome).toEqual({ kind: "granted" });
    expect(api.setIntegrationTokenProjects).toHaveBeenCalledWith(
      {
        clientId: "org-1",
        tokenId: "t-2",
        name: "mate-broker",
        projects: [
          { projectId: "p-gitea", roleCode: "BASIC_USER" },
          { projectId: "p-mate", roleCode: "BASIC_USER" },
        ],
        roleCode: "READ_ONLY",
      },
      undefined,
    );
  });

  it("a broker token with org BASIC_USER needs no project grant", async () => {
    const api = apiFake({
      listIntegrationTokens: vi
        .fn()
        .mockResolvedValue([{ ...BROKER, roleCode: "BASIC_USER", projects: [] }]),
    });
    const outcome = await grantBrokerProject({
      client: api as never,
      clientId: "org-1",
      projectId: "p-mate",
    });

    expect(outcome).toEqual({ kind: "granted" });
    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
  });

  it("writes nothing when the broker already reaches the project", async () => {
    const api = apiFake({
      listIntegrationTokens: vi
        .fn()
        .mockResolvedValue([
          { ...BROKER, projects: [{ projectId: "p-mate", roleCode: "BASIC_USER" }] },
        ]),
    });
    const outcome = await grantBrokerProject({
      client: api as never,
      clientId: "org-1",
      projectId: "p-mate",
    });

    expect(outcome).toEqual({ kind: "granted" });
    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an account with no broker yet",
      patch: { listIntegrationTokens: vi.fn().mockResolvedValue([]) },
      expected: { kind: "no-broker", reason: "This account has no broker to deploy with yet." },
    },
    {
      name: "a token list that could not be read",
      patch: { listIntegrationTokens: vi.fn().mockRejectedValue(new Error("Not signed in.")) },
      expected: { kind: "failed", reason: "Not signed in." },
    },
    {
      name: "a grant write the platform refused",
      patch: { setIntegrationTokenProjects: vi.fn().mockRejectedValue(new Error("Forbidden.")) },
      expected: { kind: "failed", reason: "Forbidden." },
    },
  ])("says so for $name, and throws nothing", async ({ patch, expected }) => {
    const outcome = await grantBrokerProject({
      client: apiFake(patch) as never,
      clientId: "org-1",
      projectId: "p-mate",
    });
    expect(outcome).toEqual(expected);
  });
});

describe("brokerGrantTokens", () => {
  it("grants from the list as the platform holds it now, never the shared list a surface holds", async () => {
    const calls: Array<string> = [];
    let held = [BROKER];
    const store = await makeTokenStore({ calls, tokens: () => held });
    try {
      // A surface holds the organization's tokens, read once.
      const unmount = store.registry.mount(store.runtime.cells.known(store.tokensRequest));
      await vi.waitFor(() => expect(calls).toEqual(["shared tokens of org-1"]));

      // Meanwhile a Mate was registered: the broker reaches its project now.
      held = [
        {
          ...BROKER,
          projects: [...BROKER.projects, { projectId: "p-mate", roleCode: "BASIC_USER" as const }],
        },
      ];
      const outcome = await grantBrokerProject({
        client: brokerGrantTokens(store.runtime),
        clientId: "org-1",
        projectId: "p-new",
      });

      expect(outcome).toEqual({ kind: "granted" });
      // One read finds the broker, the one under its lock plans the write.
      expect(calls.slice(1)).toEqual([
        "list tokens of org-1",
        "list tokens of org-1",
        "grant p-gitea,p-mate,p-new in org-1 as READ_ONLY",
      ]);
      unmount();
    } finally {
      await store.close();
    }
  });
});

describe("two grants of one broker at once", () => {
  it("both land: neither writes from the list the other is about to replace", async () => {
    const calls: Array<string> = [];
    let held: ReadonlyArray<ZeropsIntegrationToken> = [BROKER];
    // Two tabs of one account, each its own runtime, over one platform.
    const tab = () =>
      makeTokenStore({
        calls,
        tokens: () => held,
        // Each write lands a moment after it is sent: room for the other grant to read meanwhile.
        beforeWrite: () => new Promise((resolve) => setTimeout(resolve, 20)),
        onWrite: (write) => {
          held = held.map((token) =>
            token.id === write.tokenId ? { ...token, projects: write.projects } : token,
          );
        },
      });
    const stores = [await tab(), await tab()];
    // One browser's locks, which exclude across its tabs; each tab queues in its own page.
    const chains = new Map<string, Promise<unknown>>();
    const browser: TokenWriteLocks = {
      request: (name, hold) => {
        const next = (chains.get(name) ?? Promise.resolve()).then(hold);
        chains.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    };
    try {
      const outcomes = await Promise.all(
        stores.map((store, index) =>
          grantBrokerProject({
            client: brokerGrantTokens(store.runtime, makeTokenWriteLock(browser)),
            clientId: "org-1",
            projectId: index === 0 ? "p-a" : "p-b",
          }),
        ),
      );
      expect(outcomes).toEqual([{ kind: "granted" }, { kind: "granted" }]);
      expect((held[0]?.projects ?? []).map((project) => project.projectId).toSorted()).toEqual([
        "p-a",
        "p-b",
        "p-gitea",
      ]);
    } finally {
      await Promise.all(stores.map((store) => store.close()));
    }
  });

  it("an aborted grant reads and writes nothing more", async () => {
    const calls: Array<string> = [];
    const store = await makeTokenStore({ calls, tokens: () => [BROKER] });
    try {
      const controller = new AbortController();
      controller.abort();
      const outcome = await grantBrokerProject({
        client: brokerGrantTokens(store.runtime),
        clientId: "org-1",
        projectId: "p-a",
        signal: controller.signal,
      });
      expect(outcome.kind).toBe("failed");
      expect(calls).toEqual([]);
    } finally {
      await store.close();
    }
  });
});

describe("a broker token replaced between the reads", () => {
  it("is not reported granted: nothing was written to it", async () => {
    const calls: Array<string> = [];
    let reads = 0;
    // The broker's token was replaced after the read that found it.
    const store = await makeTokenStore({
      calls,
      tokens: () => (reads++ === 0 ? [BROKER] : [{ ...BROKER, id: "t-9" }]),
    });
    try {
      const outcome = await grantBrokerProject({
        client: brokerGrantTokens(store.runtime),
        clientId: "org-1",
        projectId: "p-new",
      });
      expect(outcome.kind).toBe("failed");
      expect(calls.filter((call) => call.startsWith("grant"))).toEqual([]);
    } finally {
      await store.close();
    }
  });
});
