import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import { LAYER_TURNS_MS, makeMemberAccount } from "./__fixtures__/sampledAccount";
import {
  accountHqApi,
  nextHqStanding,
  readOfficialHqNow,
  readBundledCore,
  useAccountHq,
  useCarriedCoreBuild,
  useOfficialHq,
  type AccountHq,
  type HqStanding,
} from "./accountHq";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { keepHqVerdict } from "./hqVerdict";
import { keptHqSessions } from "./keptSessions";
import { AccountDataContext } from "./ZeropsAccountData";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import { ZeropsSessionContext } from "./sessionContext";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

describe("nextHqStanding", () => {
  const parts = { quarantined: [] };
  const healthy = { kind: "healthy", build: "b1", parts } as const;
  const down = { kind: "unreachable" } as const;
  const unchecked = { kind: "unchecked", build: "b1", parts } as const;
  it.each<[string, HqStanding, Parameters<typeof nextHqStanding>[1], HqStanding]>([
    [
      "a first answer as the official HQ",
      { kind: "unknown" },
      healthy,
      { kind: "healthy", build: "b1", parts },
    ],
    [
      "a first read that fails: unavailable from now",
      { kind: "unknown" },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    [
      "an outage keeps the time it began",
      { kind: "unavailable", since: 1_000 },
      { kind: "not-ready", state: "standby", official: "unknown" },
      { kind: "unavailable", since: 1_000 },
    ],
    [
      "HQ back",
      { kind: "unavailable", since: 1_000 },
      healthy,
      { kind: "healthy", build: "b1", parts },
    ],
    // An HQ that serves but cannot check Zerops right now is no outage: everything keeps using it.
    [
      "an HQ that cannot check Zerops",
      { kind: "healthy", build: "b1", parts },
      unchecked,
      { kind: "unchecked", build: "b1", parts },
    ],
    [
      "an HQ answering again, Zerops still unchecked",
      { kind: "unavailable", since: 1_000 },
      unchecked,
      { kind: "unchecked", build: "b1", parts },
    ],
    [
      "an unchecked HQ that stops answering: unavailable from now",
      { kind: "unchecked", build: "b1", parts },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    // The build it runs, as its health says it, so an offered update costs no read of its own.
    [
      "a new build answering",
      { kind: "healthy", build: "b1", parts },
      { kind: "healthy", build: "b2", parts },
      { kind: "healthy", build: "b2", parts },
    ],
    // How its parts stand, as its newest answer reports them: no read of their own.
    [
      "a backup that failed since the last answer",
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "ok", takenAt: 1 } },
      },
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "failed", reason: "store" } },
      },
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "failed", reason: "store" } },
      },
    ],
  ])("%s", (_name, previous, health, expected) => {
    expect(nextHqStanding(previous, health, 5_000)).toEqual(expected);
  });
});

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

// Step A, open question 1: the member list names the official HQ, and KRLS's took tens of seconds
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
    // The account's data layer runs on its own runtime: its first read lands a few turns later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
    // The account's data layer runs on its own runtime: its first read lands a few turns later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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

  it("an HQ that refuses as not official reads the member list once", async () => {
    const OLD = { projectId: "P_OLD", address: "https://old.example.test" };
    keepHqVerdict({ account: scope.account, clientId: "org-moved" }, OLD);
    // An admin moved the anchor: the member list names another HQ now.
    const hq = await rendered("org-moved", [anchor("P_NEW", "https://new.example.test")]);
    expect(hq.reads()).toBe(0);

    // The kept HQ's door: not serving, and its health says it is not the organization's HQ.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("/health")
        ? Response.json({ state: "standby", official: "anchor_elsewhere", build: "b1" })
        : Response.json({ code: "not_active" }, { status: 503 }),
    );
    const client = {
      accountEpoch: 1,
      mintThrowaway: async (
        _input: unknown,
        options: { readonly beforeMint?: () => Promise<void> },
      ) => {
        await options.beforeMint?.();
        return { id: "t-1", token: "door-token", mintingToken: "minting" };
      },
      deleteThrowaway: async () => {},
    } as unknown as ZeropsApiClient;
    await act(async () => {
      await accountHqApi(client, "org-moved", OLD)
        .structure()
        .catch(() => undefined);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
    expect([hq.reads(), hq.last().hq]).toEqual([
      1,
      { kind: "official", projectId: "P_NEW", address: "https://new.example.test" },
    ]);
  });

  it("an HQ that refuses as not official reads a member list read this session again", async () => {
    const OLD = { projectId: "P_OLD", address: "https://old.example.test" };
    // This session read the member list, which named the old HQ, and keeps that verdict.
    const members = [anchor(OLD.projectId, OLD.address)];
    const hq = await rendered("org-moved-read", members);
    expect([hq.reads(), hq.last().hq]).toEqual([1, { kind: "official", ...OLD }]);
    // An admin moved the anchor: the member list names another HQ now.
    members.splice(0, 1, anchor("P_NEW", "https://new.example.test"));

    // The kept HQ's door: not serving, and its health says it is not the organization's HQ.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("/health")
        ? Response.json({ state: "standby", official: "anchor_elsewhere", build: "b1" })
        : Response.json({ code: "not_active" }, { status: 503 }),
    );
    const client = {
      accountEpoch: 1,
      mintThrowaway: async (
        _input: unknown,
        options: { readonly beforeMint?: () => Promise<void> },
      ) => {
        await options.beforeMint?.();
        return { id: "t-1", token: "door-token", mintingToken: "minting" };
      },
      deleteThrowaway: async () => {},
    } as unknown as ZeropsApiClient;
    await act(async () => {
      await accountHqApi(client, "org-moved-read", OLD)
        .structure()
        .catch(() => undefined);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
    expect([hq.reads(), hq.last().hq]).toEqual([
      2,
      { kind: "official", projectId: "P_NEW", address: "https://new.example.test" },
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
    // The account's data layer runs on its own runtime: its first read lands a few turns later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
    return {
      last: () => seen.at(-1)!,
      answer: async (members: ReadonlyArray<ZeropsOrganizationMember>) => {
        await act(async () => {
          answer(members);
          await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
        });
      },
      refuse: async (cause: unknown) => {
        await act(async () => {
          refuse(cause);
          await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
        });
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
      mintThrowaway: async () => {
        mints += 1;
        return { id: "t-1", token: "door-1", mintingToken: "minting" };
      },
      deleteThrowaway: async () => {},
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
    await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
      mintThrowaway: async () => {
        mints += 1;
        return { id: "t-1", token: "door-1", mintingToken: "minting" };
      },
      deleteThrowaway: async () => {},
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
  /** How many door calls from now on HQ answers it is not serving, before it admits. */
  let notServing: number;
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
    notServing = 0;
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
        presented.push((JSON.parse(String(init?.body)) as { readonly token: unknown }).token);
        if (notServing > 0) {
          notServing -= 1;
          return Response.json({ code: "not_active" }, { status: 503 });
        }
        return Response.json({
          session: issuedSession(++issued),
          expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
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
  /** A load's client: each load builds its own, and mints a throwaway for every door. */
  const load = () => {
    let mints = 0;
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      mintThrowaway: async (
        _input: unknown,
        options: { readonly beforeMint?: () => Promise<void> },
      ) => {
        await options.beforeMint?.();
        mints += 1;
        return { id: `t-${mints}`, token: `door-${mints}`, mintingToken: "minting" };
      },
      deleteThrowaway: async () => {},
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

  // KRLS, 2026-10-03: while the organization's reads stalled, one person's HQ door left eight
  // throwaways in 21 s, one per try. A door HQ did not answer is tried again with the same one.
  it("a door HQ is not serving is tried again with the throwaway it already minted", async () => {
    notServing = 1;
    const first = load();
    const api = accountHqApi(first.client, "org-1", HQ);
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable" });
    await api.structure();

    expect(first.doors()).toBe(1);
    expect(presented).toHaveLength(2);
    expect(presented[1]).toBe(presented[0]);
  });

  it("a sign-out revokes HQ's session and forgets it", async () => {
    await accountHqApi(load().client, "org-1", HQ).structure();

    closeAccountLifetime();
    // The close ends the account's sessions once no other tab holds it open.
    await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));

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
    // The account's data layer runs on its own runtime: its first read lands a few turns later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LAYER_TURNS_MS));
    });
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
    expect((await readOfficialHqNow(account.value, registry, "org-1")).kind).toBe("none");
    members = [ANCHOR];
    expect(await readOfficialHqNow(account.value, registry, "org-1")).toEqual({
      kind: "official",
      projectId: "P_HQ",
      address: "https://hq.example.test",
    });
    expect(account.reads()).toBe(2);
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
