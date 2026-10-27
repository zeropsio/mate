import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { classifyHqCall, organizationMembers } from "@t3tools/client-runtime/data";
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsApiClient, ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import { hqAnchorName } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/reactivity";

import { makeMemberAccount } from "./__fixtures__/sampledAccount";
import {
  accountHqApi,
  configuredHq,
  readOfficialHqNow,
  readBundledCore,
  useAccountHq,
  useCarriedCoreBuild,
  useOfficialHq,
  type AccountHq,
  type HqStanding,
} from "./accountHq";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { hqOutage } from "./hqNavigation";
import { keepHqVerdict } from "./hqVerdict";
import { keptHqSessions } from "./keptSessions";
import { AccountDataContext } from "./ZeropsAccountData";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import { ZeropsSessionContext } from "./sessionContext";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

/** React has published the layer's answer, not merely admitted its request. */
const reconciled = (assertion: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {});
      assertion();
    },
    { timeout: 5_000 },
  );

describe("readBundledCore — Core as this build carries it", () => {
  const TAR = new TextEncoder().encode("dist/main.mjs and zerops.yml, as a plain tar");
  const gunzip = async (bytes: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
  const gzip = async (bytes: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
  /** A server answering the build's three files; `archive` as the browser hands its body over. */
  const served = (archive: Uint8Array<ArrayBuffer>) => {
    const asked: Array<string> = [];
    const fetch = async (input: RequestInfo | URL) => {
      const path = String(input);
      asked.push(path);
      if (path.endsWith("/build.json")) {
        return new Response(JSON.stringify({ build: "20261004T100000Z.0123456789ab" }));
      }
      return path.endsWith("/zerops.yml")
        ? new Response("zerops:\n  - setup: hq\n")
        : new Response(archive);
    };
    return { asked, fetch: fetch as typeof globalThis.fetch };
  };

  it("hands over a gzip even where the server sent it gzip-encoded and the browser unpacked it", async () => {
    // Measured on the rig, 2026-10-02: a static server served `core.tar.gz` with
    // `Content-Encoding: gzip`, the browser decoded it, and Core's build failed on a plain tar.
    const { fetch } = served(TAR);
    const core = await readBundledCore(fetch, "/hq-core");
    expect(Array.from(core.archive.subarray(0, 2))).toEqual([0x1f, 0x8b]);
    expect(await gunzip(core.archive)).toEqual(TAR);
    expect(core.zeropsYaml).toBe("zerops:\n  - setup: hq\n");
  });

  it("hands a gzip it was given over byte for byte, from a name no server takes for an encoding", async () => {
    const archive = await gzip(TAR);
    const { asked, fetch } = served(archive);
    const core = await readBundledCore(fetch, "/hq-core");
    expect(core.archive).toEqual(archive);
    expect(core.build).toBe("20261004T100000Z.0123456789ab");
    expect(asked).toEqual(["/hq-core/core.tgz.bin", "/hq-core/zerops.yml", "/hq-core/build.json"]);
  });
});

// Step A, open question 1: the member list names the official HQ, and the organization's took tens of seconds
// to read. A page holds the verdict per account and organization in memory, and reads the list
// again only on first use, or after HQ refuses as not official.
/** The anchor an org admin minted for the HQ at `address`: what the member list names it by. */
const anchor = (projectId: string, address: string) =>
  ({
    id: `cu-${projectId}`,
    roleCode: "ADMIN",
    status: "ACTIVE",
    user: { fullName: hqAnchorName(projectId, address), email: `token-${projectId}@zerops.io` },
  }) as ZeropsOrganizationMember;

// What an owner's update offer weighs HQ's Core against: read once per tab, in a shown one only.
describe("useCarriedCoreBuild — the Core this app carries", () => {
  it("is read once the tab is shown, once for every reader", async () => {
    const listeners = new Set<() => void>();
    const page = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const fetched: string[] = [];
    vi.stubGlobal("document", page);
    vi.stubGlobal("fetch", async (input: string) => {
      fetched.push(input);
      return new Response(JSON.stringify({ build: "20261004T100000Z.0123456789ab" }));
    });
    try {
      const seen: Array<string | undefined> = [];
      function Reader() {
        seen.push(useCarriedCoreBuild());
        return null;
      }
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(createElement("div", null, createElement(Reader), createElement(Reader)));
      });
      expect(fetched).toEqual([]);
      await act(async () => {
        page.visibilityState = "visible";
        for (const listener of listeners) listener();
      });
      expect(fetched).toHaveLength(1);
      expect(fetched[0]).toMatch(/hq-core\/build\.json$/u);
      expect(seen.at(-1)).toBe("20261004T100000Z.0123456789ab");
      await act(async () => {
        tree.unmount();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("useAccountHq — the official HQ this page holds", () => {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    },
    epoch: AccountEpoch.make(1),
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * `useAccountHq` for `clientId` over an organization whose member list is `members`, counting its
   * reads; HQ's structure stream unavailable since `unavailableSince` (wall ms) where it says.
   */
  async function rendered(
    clientId: string,
    members: ReadonlyArray<ZeropsOrganizationMember>,
    unavailableSince: number | null = null,
  ) {
    const registry = AtomRegistry.make();
    mountHqNavigation(registry, clientId, { live: unavailableSince === null });
    let reads = 0;
    const account = makeMemberAccount({
      registry,
      orgId: clientId,
      members: async () => {
        reads += 1;
        return members;
      },
    });
    const data = {
      scope,
    } as unknown as ZeropsDataContextValue;
    const seen: Array<AccountHq> = [];
    function Probe() {
      seen.push(useAccountHq(clientId));
      return null;
    }
    await act(async () => {
      create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            ZeropsDataContext.Provider,
            { value: data },
            createElement(
              AccountDataContext.Provider,
              { value: account.value },
              createElement(Probe),
            ),
          ),
        ),
      );
    });
    await reconciled(() => expect(seen.at(-1)?.status).toMatch(/^(ready|failed)$/));
    return { reads: () => reads, last: () => seen.at(-1)! };
  }

  it("keeps the official HQ effect identity when the anchor still names the same address and API", async () => {
    const owner = { account: scope.account, clientId: "org-stable" };
    const endpoint = { projectId: "P_STABLE", address: "https://stable.example.test" };
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: owner.clientId,
      members: async () => [anchor(endpoint.projectId, endpoint.address)],
    });
    const data = {
      scope,
    } as unknown as ZeropsDataContextValue;
    const session = {
      client: { accountEpoch: "stable-account" },
      activeOrganization: { id: owner.clientId },
    } as unknown as ZeropsSessionValue;
    const seen: Array<ReturnType<typeof useOfficialHq>> = [];
    function Probe() {
      seen.push(useOfficialHq());
      return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            ZeropsDataContext.Provider,
            { value: data },
            createElement(
              ZeropsSessionContext.Provider,
              { value: session },
              createElement(
                AccountDataContext.Provider,
                { value: account.value },
                createElement(Probe),
              ),
            ),
          ),
        ),
      );
    });
    await reconciled(() => expect(seen.some((hq) => hq !== null)).toBe(true));
    const first = seen.find((hq) => hq !== null);
    expect(first).toBeDefined();
    expect(seen.filter((hq) => hq !== null).every((hq) => hq === first)).toBe(true);
    await act(async () => {
      keepHqVerdict(owner, { ...endpoint });
    });
    expect(seen.at(-1)?.api).toBe(first?.api);
    expect(seen.at(-1)).toBe(first);
    await act(async () => {
      keepHqVerdict(owner, { ...endpoint, address: "https://moved.example.test" });
    });
    expect(seen.at(-1)?.address).toBe("https://moved.example.test");
    expect(seen.at(-1)?.api).not.toBe(first?.api);
    await act(async () => {
      tree?.unmount();
    });
  });

  // source data stays out of browser storage — the verdict lives in this page alone.
  it("keeps what the member list said in this page's memory, never in browser storage", async () => {
    const written: Array<string> = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (key: string) => written.push(key),
      removeItem: () => undefined,
    });
    const hq = await rendered("org-memory", [anchor("P_HQ", "https://hq.example.test")]);
    expect(hq.last().hq).toEqual({
      kind: "official",
      projectId: "P_HQ",
      address: "https://hq.example.test",
    });
    expect(written).toEqual([]);
  });

  it("a reader while this page holds the verdict reads no member list", async () => {
    keepHqVerdict(
      { account: scope.account, clientId: "org-kept" },
      {
        projectId: "P_HQ",
        address: "https://hq.example.test",
      },
    );
    const hq = await rendered("org-kept", [anchor("P_HQ", "https://hq.example.test")]);
    expect([hq.reads(), hq.last().status, hq.last().hq]).toEqual([
      0,
      "ready",
      { kind: "official", projectId: "P_HQ", address: "https://hq.example.test" },
    ]);
  });

  it("a stream outage does not silently change the kept HQ verdict", async () => {
    const HQ = { projectId: "P_HQ", address: "https://hq.example.test" };
    keepHqVerdict({ account: scope.account, clientId: "org-out" }, HQ);
    const hq = await rendered(
      "org-out",
      [anchor("P_HQ", "https://hq.example.test")],
      Date.now() - 11 * 60_000,
    );
    // Reconnecting the stream must not silently rediscover or change the official HQ.
    expect([hq.reads(), hq.last().hq]).toEqual([0, { kind: "official", ...HQ }]);
  });
});

// Trust on verify (coordinator, 2026-10-06): a session the account kept for an HQ was minted only
// after that HQ was verified official, so a reload or a new tab goes to it at once; the member list
// verifies it behind, and a verdict that names another HQ drops it and its session.
describe("useAccountHq — the HQ whose session the account kept, verified behind", () => {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-k"),
    },
    epoch: AccountEpoch.make(1),
  };
  const KEPT = { projectId: "P_KEPT", address: "https://kept.example.test" };

  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    openAccountLifetime("person-k");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  /** `useAccountHq` for `clientId` whose member list answers only once `answer` is called. */
  async function pending(clientId: string) {
    let answer: (members: ReadonlyArray<ZeropsOrganizationMember>) => void = () => undefined;
    let refuse: (cause: unknown) => void = () => undefined;
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: clientId,
      members: () =>
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    });
    const data = {
      scope,
    } as unknown as ZeropsDataContextValue;
    const seen: Array<AccountHq> = [];
    function Probe() {
      seen.push(useAccountHq(clientId));
      return null;
    }
    await act(async () => {
      create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            ZeropsDataContext.Provider,
            { value: data },
            createElement(
              AccountDataContext.Provider,
              { value: account.value },
              createElement(Probe),
            ),
          ),
        ),
      );
    });
    await reconciled(() => {
      expect(account.reads()).toBe(1);
      expect(seen.length).toBeGreaterThan(0);
    });
    return {
      last: () => seen.at(-1)!,
      answer: async (members: ReadonlyArray<ZeropsOrganizationMember>) => {
        await act(async () => {
          answer(members);
        });
        await reconciled(() => {
          expect(registry.get(account.value.data.fact("organizationMembers", clientId)).kind).toBe(
            "known",
          );
          expect(seen.at(-1)?.status).toBe("ready");
        });
      },
      refuse: async (cause: unknown) => {
        await act(async () => {
          refuse(cause);
        });
        await reconciled(() => expect(seen.at(-1)?.status).toBe("failed"));
      },
    };
  }

  /** HQ's API calls, as the page sends them. */
  const heard = () => {
    const calls: Array<{
      readonly method: string;
      readonly url: string;
      readonly auth: string | null;
    }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
      });
      const path = new URL(String(input)).pathname;
      if (path === "/api/structure") return Response.json({ apps: [] });
      if (path === "/api/apps")
        return Response.json({ id: "app-1", name: "Acme" }, { status: 201 });
      return new Response(null, { status: 204 });
    });
    return calls;
  };
  const noDoorClient = (accountEpoch: number) =>
    ({
      accountEpoch,
      mintThrowaway: async () => {
        throw new Error("no door in this test");
      },
      deleteThrowaway: async () => {},
    }) as unknown as ZeropsApiClient;

  const keepSession = (clientId: string, hq: typeof KEPT) =>
    keptHqSessions.keep(`${clientId}:${hq.projectId}:${hq.address}`, {
      address: hq.address,
      token: `session-${clientId}`,
      expiresAtEpochMs: Date.now() + 12 * 3_600_000,
    });

  it("goes to the kept HQ before the member list answers, and stays once it names it", async () => {
    keepSession("org-kept-a", KEPT);
    const hq = await pending("org-kept-a");
    expect([hq.last().status, hq.last().hq]).toEqual(["ready", { kind: "official", ...KEPT }]);
    await hq.answer([anchor(KEPT.projectId, KEPT.address)]);
    expect(hq.last().hq).toEqual({ kind: "official", ...KEPT });
    expect(keptHqSessions.read(`org-kept-a:${KEPT.projectId}:${KEPT.address}`)).not.toBeNull();
  });

  it("drops the kept HQ and its session once the member list names another", async () => {
    keepSession("org-kept-b", KEPT);
    const hq = await pending("org-kept-b");
    await hq.answer([anchor("P_NEW", "https://new.example.test")]);
    expect(hq.last().hq).toEqual({
      kind: "official",
      projectId: "P_NEW",
      address: "https://new.example.test",
    });
    expect(keptHqSessions.read(`org-kept-b:${KEPT.projectId}:${KEPT.address}`)).toBeNull();
  });

  it("falls back to the member list once the kept HQ refuses its session, entering no door", async () => {
    keepSession("org-kept-r", KEPT);
    const hq = await pending("org-kept-r");
    vi.stubGlobal("fetch", async () =>
      Response.json({ code: "session_required" }, { status: 401 }),
    );
    let mints = 0;
    const client = {
      accountEpoch: 901,
      accessToken: async () => {
        mints += 1;
        return "access";
      },
    } as unknown as ZeropsApiClient;
    await act(async () => {
      await expect(accountHqApi(client, "org-kept-r", KEPT).structure()).rejects.toMatchObject({
        code: "hq_unverified",
      });
    });
    expect(mints).toBe(0);
    expect([hq.last().status, hq.last().hq.kind]).toEqual(["loading", "none"]);
  });

  it("reads the kept HQ at once, but writes to it only once the member list names it", async () => {
    keepSession("org-kept-w", KEPT);
    const hq = await pending("org-kept-w");
    const calls = heard();
    const api = accountHqApi(noDoorClient(902), "org-kept-w", KEPT);
    await api.structure();
    const created = api.createApp("Acme");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /api/structure",
    ]);
    await hq.answer([anchor(KEPT.projectId, KEPT.address)]);
    await expect(created).resolves.toMatchObject({ id: "app-1" });
  });

  it("refuses a write held for a kept HQ the member list then names not", async () => {
    keepSession("org-kept-x", KEPT);
    const hq = await pending("org-kept-x");
    heard();
    const created = accountHqApi(noDoorClient(903), "org-kept-x", KEPT).createApp("Acme");
    const outcome = created.catch((cause: unknown) => cause);
    await hq.answer([anchor("P_NEW", "https://new.example.test")]);
    expect(await outcome).toMatchObject({ kind: "refused", code: "hq_not_official" });
  });

  it("ends the trust visibly when the member list is refused for good", async () => {
    keepSession("org-kept-f", KEPT);
    const hq = await pending("org-kept-f");
    await hq.refuse(new Error("insufficientPermissions"));
    expect([hq.last().status, hq.last().hq.kind]).toEqual(["failed", "none"]);
  });

  it("revokes at the kept HQ the session it drops on a mismatch", async () => {
    keepSession("org-kept-v", KEPT);
    const hq = await pending("org-kept-v");
    const calls = heard();
    await hq.answer([anchor("P_NEW", "https://new.example.test")]);
    await reconciled(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(calls).toContainEqual({
      method: "DELETE",
      url: `${KEPT.address}/api/session`,
      auth: "Bearer session-org-kept-v",
    });
  });

  it("without a kept session waits for the member list, as before", async () => {
    const hq = await pending("org-cold");
    expect(hq.last().status).toBe("loading");
  });

  it("enters no door of a kept HQ the member list has not yet named", async () => {
    let mints = 0;
    const client = {
      accountEpoch: 900,
      accessToken: async () => {
        mints += 1;
        return "access";
      },
    } as unknown as ZeropsApiClient;
    await expect(accountHqApi(client, "org-unverified", KEPT).structure()).rejects.toMatchObject({
      kind: "unavailable",
      code: "hq_unverified",
    });
    expect(mints).toBe(0);
  });
});

// Audit K7: HQ's session lived in a tab's memory only, so every load paid a throwaway's mint and
// delete through HQ's door, and a sign-out left the session HQ issued valid for its 12 hours.
describe("accountHqApi — HQ's session, kept as the Mates' sessions are", () => {
  const HQ = { projectId: "P_HQ", address: "https://hq.example.test" };
  const HOUR_MS = 3_600_000;
  /** What HQ was asked, in order. */
  let calls: Array<{
    readonly method: string;
    readonly path: string;
    readonly authorization: string | null;
  }>;
  /** How long a session HQ issues from now on lasts. */
  let lifetimeMs: number;
  /** How many door calls from now on HQ answers 503, before it admits. */
  let unanswered: number;
  /** The throwaways each door call presented, in order. */
  let presented: Array<unknown>;
  let stored: Map<string, string>;
  /** This test's run: the page remembers every token it ended, so no two tests share one. */
  let run = 0;
  /** The `n`th session HQ issued in this test. */
  const issuedSession = (n: number) => `session-${String(run)}-${String(n)}`;

  beforeEach(() => {
    run += 1;
    calls = [];
    lifetimeMs = 12 * HOUR_MS;
    unanswered = 0;
    presented = [];
    stored = new Map();
    let issued = 0;
    // The account's scoped storage reads this browser's `window.localStorage`.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.pathname === "/api/door") {
        presented.push(
          (JSON.parse(String(init?.body)) as { readonly accessToken: unknown }).accessToken,
        );
        if (unanswered > 0) {
          unanswered -= 1;
          return Response.json({ code: "zerops_unanswered" }, { status: 503 });
        }
        return Response.json({
          session: issuedSession(++issued),
          expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
          orgId: "org-1",
          userId: "u1",
        });
      }
      if (url.pathname === "/api/structure") return Response.json({ apps: [] });
      return new Response(null, { status: 204 });
    });
    openAccountLifetime("person-1");
    named();
  });
  /** The member list named this HQ: its door may be entered. */
  const named = () =>
    keepHqVerdict(
      {
        account: { apiOrigin: "https://api.example.test", accountId: "person-1" },
        clientId: "org-1",
      },
      HQ,
    );
  afterEach(() => {
    // The close ends what the account kept: HQ is still there to hear it.
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  /** The page's account epochs only grow, across tests too: the mint budget is fenced by them. */
  let epoch = 0;
  /** A load's client: each load builds its own, and reads the access token for every door. */
  const load = () => {
    let mints = 0;
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      accessToken: async () => {
        mints += 1;
        return "access";
      },
    } as unknown as ZeropsApiClient;
    return { client, doors: () => mints };
  };

  it("a reload with a kept session that is still valid comes through no door", async () => {
    const first = load();
    await accountHqApi(first.client, "org-1", HQ).structure();
    expect(first.doors()).toBe(1);

    const reload = load();
    await accountHqApi(reload.client, "org-1", HQ).structure();

    expect(reload.doors()).toBe(0);
    expect(calls.at(-1)).toEqual({
      method: "GET",
      path: "/api/structure",
      authorization: `Bearer ${issuedSession(1)}`,
    });
  });

  it("a reload whose kept session is ending comes through one door, and keeps the new one", async () => {
    // HQ issued a session that ends in ten minutes: within the lead, it is not presented again.
    lifetimeMs = 10 * 60_000;
    await accountHqApi(load().client, "org-1", HQ).structure();
    lifetimeMs = 12 * HOUR_MS;

    const reload = load();
    await accountHqApi(reload.client, "org-1", HQ).structure();
    expect(reload.doors()).toBe(1);
    expect(calls.at(-1)?.authorization).toBe(`Bearer ${issuedSession(2)}`);

    const again = load();
    await accountHqApi(again.client, "org-1", HQ).structure();
    expect(again.doors()).toBe(0);
    expect(calls.at(-1)?.authorization).toBe(`Bearer ${issuedSession(2)}`);
  });

  it("a door that answers 503 is tried again with the access token, minting nothing", async () => {
    unanswered = 1;
    const first = load();
    const api = accountHqApi(first.client, "org-1", HQ);
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable" });
    await api.structure();

    expect(presented).toEqual(["access", "access"]);
  });

  it("a sign-out revokes HQ's session and forgets it", async () => {
    await accountHqApi(load().client, "org-1", HQ).structure();

    closeAccountLifetime();
    // The close ends the account's sessions once no other tab holds it open.
    await reconciled(() => expect(calls.at(-1)?.method).toBe("DELETE"));

    expect(calls.at(-1)).toEqual({
      method: "DELETE",
      path: "/api/session",
      authorization: `Bearer ${issuedSession(1)}`,
    });
    expect([...stored.keys()].filter((key) => key.endsWith(":hq-sessions.v1"))).toEqual([]);
    // Signed in again, nothing is kept: the next load comes through the door.
    openAccountLifetime("person-1");
    named();
    const next = load();
    await accountHqApi(next.client, "org-1", HQ).structure();
    expect(next.doors()).toBe(1);
  });
});

describe("useAccountHq — no official HQ, kept too", () => {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-n"),
    },
    epoch: AccountEpoch.make(1),
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** One load of `useAccountHq` for `clientId`, its member list `members()` as each read answers. */
  async function loaded(clientId: string, members: () => ReadonlyArray<ZeropsOrganizationMember>) {
    let reads = 0;
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: clientId,
      members: async () => {
        reads += 1;
        return members();
      },
    });
    const data = {
      scope,
    } as unknown as ZeropsDataContextValue;
    const seen: Array<AccountHq> = [];
    function Probe() {
      seen.push(useAccountHq(clientId));
      return null;
    }
    await act(async () => {
      create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            ZeropsDataContext.Provider,
            { value: data },
            createElement(
              AccountDataContext.Provider,
              { value: account.value },
              createElement(Probe),
            ),
          ),
        ),
      );
    });
    await reconciled(() => expect(seen.at(-1)?.status).toMatch(/^(ready|failed)$/));
    return { reads: () => reads, last: () => seen.at(-1)! };
  }

  it("a second reader of an organization its member list said has no HQ reads no member list", async () => {
    const first = await loaded("org-none", () => []);
    expect([first.reads(), first.last().status, first.last().hq.kind]).toEqual([
      1,
      "ready",
      "none",
    ]);

    const next = await loaded("org-none", () => []);
    expect([next.reads(), next.last().status, next.last().hq.kind]).toEqual([0, "ready", "none"]);
  });

  it("reads it again on the person's Try again after the member list was refused", async () => {
    let refused = true;
    const hq = await loaded("org-refused", () => {
      if (refused) throw new Error("insufficientPermissions");
      return [anchor("P_HQ", "https://hq.example.test")];
    });
    expect([hq.reads(), hq.last().status]).toEqual([1, "failed"]);

    refused = false;
    await act(async () => {
      hq.last().reread();
    });
    await reconciled(() =>
      expect(hq.last().hq).toMatchObject({ kind: "official", projectId: "P_HQ" }),
    );
    expect([hq.reads(), hq.last().hq]).toEqual([
      2,
      { kind: "official", projectId: "P_HQ", address: "https://hq.example.test" },
    ]);
  });

  it("reads it again at once for this browser's own birth or a press, and keeps what it names", async () => {
    let members: ReadonlyArray<ZeropsOrganizationMember> = [];
    const hq = await loaded("org-born", () => members);
    expect([hq.reads(), hq.last().hq.kind]).toEqual([1, "none"]);

    // The birth minted the anchor: the member list names HQ now.
    members = [anchor("P_HQ", "https://hq.example.test")];
    await act(async () => {
      hq.last().reread();
    });
    await reconciled(() =>
      expect(hq.last().hq).toMatchObject({ kind: "official", projectId: "P_HQ" }),
    );
    const official = { kind: "official", projectId: "P_HQ", address: "https://hq.example.test" };
    expect([hq.reads(), hq.last().hq]).toEqual([2, official]);
    const next = await loaded("org-born", () => members);
    expect([next.reads(), next.last().hq]).toEqual([0, official]);
  });
});

// Another admin can create HQ after the gate last read an empty member list.
describe("readOfficialHqNow", () => {
  const ANCHOR = {
    id: "cu-anchor",
    roleCode: "ADMIN",
    status: "ACTIVE",
    user: { fullName: "mate-hq:P_HQ:https://hq.example.test", email: "token-hq@zerops.io" },
  } as ZeropsOrganizationMember;

  it("reads the store's official HQ afresh at each birth attempt", async () => {
    let members: ReadonlyArray<ZeropsOrganizationMember> = [];
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({ registry, orgId: "org-1", members: async () => members });
    await expect(readOfficialHqNow(account.value, registry, "org-1")).resolves.toEqual({
      kind: "none",
    });
    members = [ANCHOR];
    await expect(readOfficialHqNow(account.value, registry, "org-1")).resolves.toEqual({
      kind: "official",
      projectId: "P_HQ",
      address: "https://hq.example.test",
    });
    expect(account.reads()).toBe(2);
    expect(
      registry.get(
        account.value.data.project(organizationMembers, { orgId: "org-1", clientId: "org-1" }),
      ),
    ).toMatchObject({
      status: "ready",
      settled: false,
      stream: { phase: "paused", demanded: false },
    });
  });

  it("does not treat a refusal as proof there is no HQ or automatically retry it", async () => {
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: "org-refused",
      members: async () => {
        throw new Error("Refused");
      },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(readOfficialHqNow(account.value, registry, "org-refused")).rejects.toThrow();
    }
    expect(account.reads()).toBe(1);
  });
});

describe("a web built with an HQ origin — one shared HQ every organization signs in to", () => {
  const SHARED = "https://hq.shared.test";
  /** What the shared HQ's door was handed, in order. */
  let doors: Array<{
    readonly accessToken: unknown;
    readonly orgId: unknown;
    readonly orgKey?: unknown;
  }>;
  /** What HQ was asked, by path, in order. */
  let paths: Array<string>;
  /** Whether an Owner or Admin has started the organization at HQ. */
  let started: boolean;
  /** HQ refuses the organization's key the door hands it. */
  let keyRejected: boolean;
  let stored: Map<string, string>;
  /** The page's account epochs only grow, across tests too: the mint budget is fenced by them. */
  let epoch = 10_000;

  beforeEach(() => {
    doors = [];
    paths = [];
    started = true;
    keyRejected = false;
    stored = new Map();
    let issued = 0;
    vi.stubEnv("VITE_HQ_ORIGIN", SHARED);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(`${url.origin}${url.pathname}`);
      if (url.pathname === "/api/door") {
        const body = JSON.parse(String(init?.body)) as (typeof doors)[number];
        doors.push(body);
        if (!started && body.orgKey === undefined)
          return Response.json({ code: "org_not_started" }, { status: 409 });
        if (keyRejected && body.orgKey !== undefined)
          return Response.json({ code: "forbidden", reason: "org_key_rejected" }, { status: 403 });
        started = true;
        return Response.json({
          session: `shared-session-${String(++issued)}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          orgId: "org-1",
          userId: "u1",
        });
      }
      if (url.pathname === "/api/structure") return Response.json({ apps: [] });
      return new Response(null, { status: 204 });
    });
    openAccountLifetime("person-shared");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** A signed-in person's client in `org-1` with `roleCode` there, counting what it mints. */
  const person = (roleCode: string) => {
    const keys: Array<unknown> = [];
    const taken: Array<string> = [];
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      accessToken: async () => "access",
      verifiedUser: () => ({
        user: { clientUserList: [{ id: "m-1", clientId: "org-1", roleCode, status: "ACTIVE" }] },
        atMs: 0,
      }),
      mintIntegrationToken: async (input: unknown) => {
        keys.push(input);
        return { id: "org-key-id", token: "org-key-1" };
      },
      deleteIntegrationToken: async (input: { readonly tokenId: string }) => {
        taken.push(input.tokenId);
      },
    } as unknown as ZeropsApiClient;
    return { client, keys, taken };
  };

  const sharedApi = (client: ZeropsApiClient) => {
    const hq = configuredHq();
    if (hq === undefined) throw new Error("This build names no HQ.");
    return accountHqApi(client, "org-1", hq);
  };

  it("A web built with an HQ origin signs in to that HQ without reading the organisation's anchor", async () => {
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: "org-1",
      members: async () => [anchor("P_ANCHORED", "https://anchored.example.test")],
    });
    const { client } = person("OWNER");
    const session = {
      client,
      activeOrganization: { id: "org-1" },
    } as unknown as ZeropsSessionValue;
    const data = {
      scope: {
        account: {
          apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
          accountId: ZeropsAccountId.make("person-shared"),
        },
        epoch: AccountEpoch.make(1),
      },
    } as unknown as ZeropsDataContextValue;
    const seen: Array<ReturnType<typeof useOfficialHq>> = [];
    function Probe() {
      seen.push(useOfficialHq());
      return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            ZeropsDataContext.Provider,
            { value: data },
            createElement(
              ZeropsSessionContext.Provider,
              { value: session },
              createElement(
                AccountDataContext.Provider,
                { value: account.value },
                createElement(Probe),
              ),
            ),
          ),
        ),
      );
    });
    const official = seen.at(-1);
    expect(official?.address).toBe(SHARED);
    await official?.api.structure();
    expect(paths).toEqual([`${SHARED}/api/door`, `${SHARED}/api/structure`]);
    expect(account.reads()).toBe(0);
    await act(async () => {
      tree?.unmount();
    });
  });

  it("Signing in to a shared HQ presents the person's Zerops access token and the organisation", async () => {
    const { client, keys } = person("BASIC_USER");
    await sharedApi(client).structure();

    expect(doors).toEqual([{ accessToken: "access", orgId: "org-1" }]);
    expect(keys).toEqual([]);
  });

  it("An Owner's first sign-in to an organisation the HQ has not started hands it a read-only key and then signs in", async () => {
    started = false;
    const { client, keys, taken } = person("OWNER");
    await sharedApi(client).structure();

    expect(keys).toEqual([
      { clientId: "org-1", name: "mate-hq-org-key", roleCode: "READ_ONLY", projects: [] },
    ]);
    // The second plain sign-in is the one inside the lock, which finds the organisation started
    // by another tab when there is one.
    expect(doors).toEqual([
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1", orgKey: "org-key-1" },
    ]);
    expect(paths.at(-1)).toBe(`${SHARED}/api/structure`);
    // HQ keeps the key it took: nothing here takes it back.
    expect(taken).toEqual([]);
  });

  it("A member's sign-in to an organisation no Owner has started says an Owner or Admin must sign in first", async () => {
    started = false;
    const { client, keys } = person("BASIC_USER");
    const refusal = await sharedApi(client)
      .structure()
      .then(
        () => null,
        (cause: unknown) => cause,
      );

    expect(refusal).toMatchObject({ kind: "refused", code: "org_not_started" });
    expect(keys).toEqual([]);
    expect(doors).toEqual([{ accessToken: "access", orgId: "org-1" }]);
    // The menu says it, with Try again as the way out once an Owner or Admin has signed in.
    const navigation = {
      live: false,
      refusal: classifyHqCall(refusal).message,
      capped: false,
      reconnecting: false,
      slow: false,
      structure: null,
    };
    expect(hqOutage(navigation, null, "24-hour", 0)).toEqual({
      kind: "refused",
      line: "An Owner or Admin of this organization must sign in to Mate first. Then try again.",
      again: true,
    });
  });

  it("An organisation's key HQ did not accept tells the person to sign in again as an Owner or Admin", async () => {
    started = false;
    keyRejected = true;
    const { client } = person("OWNER");
    const refusal = await sharedApi(client)
      .structure()
      .then(
        () => null,
        (cause: unknown) => cause,
      );

    expect(refusal).toMatchObject({ kind: "refused", code: "forbidden" });
    // The second plain sign-in is the one inside the lock, which finds the organisation started
    // by another tab when there is one.
    expect(doors).toEqual([
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1", orgKey: "org-key-1" },
    ]);
    const navigation = {
      live: false,
      refusal: classifyHqCall(refusal).message,
      capped: false,
      reconnecting: false,
      slow: false,
      structure: null,
    };
    expect(hqOutage(navigation, null, "24-hour", 0)).toEqual({
      kind: "refused",
      line: "HQ did not accept the organization's key. Sign in again as an Owner or Admin.",
      again: true,
    });
  });
});
