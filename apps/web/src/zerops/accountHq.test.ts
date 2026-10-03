import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import type { ZeropsApiClient, ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type AccountScope,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import { hqAnchorName } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/unstable/reactivity";

import { hqStructureAtom } from "~/state/zerops";

import { makeMemberCells } from "./__fixtures__/memberCells";
import {
  accountHqApi,
  nextHqStanding,
  readBundledCore,
  useAccountHq,
  type AccountHq,
  type HqStanding,
} from "./accountHq";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { keepHqVerdict } from "./hqVerdict";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

describe("nextHqStanding", () => {
  const healthy = { kind: "healthy", build: "b1" } as const;
  const down = { kind: "unreachable" } as const;
  const unchecked = { kind: "unchecked", build: "b1" } as const;
  it.each<[string, HqStanding, Parameters<typeof nextHqStanding>[1], HqStanding]>([
    ["a first answer as the official HQ", { kind: "unknown" }, healthy, { kind: "healthy" }],
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
    ["HQ back", { kind: "unavailable", since: 1_000 }, healthy, { kind: "healthy" }],
    // An HQ that serves but cannot check Zerops right now is no outage: everything keeps using it.
    ["an HQ that cannot check Zerops", { kind: "healthy" }, unchecked, { kind: "unchecked" }],
    [
      "an HQ answering again, Zerops still unchecked",
      { kind: "unavailable", since: 1_000 },
      unchecked,
      { kind: "unchecked" },
    ],
    [
      "an unchecked HQ that stops answering: unavailable from now",
      { kind: "unchecked" },
      down,
      { kind: "unavailable", since: 5_000 },
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
  /** A server answering the build's two files; `archive` as the browser hands its body over. */
  const served = (archive: Uint8Array<ArrayBuffer>) => {
    const asked: Array<string> = [];
    const fetch = async (input: RequestInfo | URL) => {
      const path = String(input);
      asked.push(path);
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
    expect(asked).toEqual(["/hq-core/core.tgz.bin", "/hq-core/zerops.yml"]);
  });
});

// Step A, open question 1: the member list names the official HQ, and KRLS's took tens of seconds
// to read. A browser keeps the verdict per account and organization, and reads the list again only
// on first use, after HQ refuses as not official, or after an outage of more than ten minutes.
describe("useAccountHq — the official HQ this browser keeps", () => {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    },
    epoch: AccountEpoch.make(1),
  };
  const organizationRef = (organizationId: string): OrganizationRef => ({
    kind: "organization",
    account: scope.account,
    organizationId: ZeropsOrganizationId.make(organizationId),
  });
  /** The anchor an org admin minted for the HQ at `address`: what the member list names it by. */
  const anchor = (projectId: string, address: string) =>
    ({
      id: `cu-${projectId}`,
      roleCode: "ADMIN",
      status: "ACTIVE",
      user: { fullName: hqAnchorName(projectId, address), email: `token-${projectId}@zerops.io` },
    }) as ZeropsOrganizationMember;

  // This browser's storage, for the verdict kept between loads.
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });
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
    registry.set(hqStructureAtom, {
      organizationId: clientId,
      structure: null,
      changes: null,
      readAt: null,
      current: unavailableSince === null,
      unavailableSince,
    });
    let reads = 0;
    const cells = await makeMemberCells({
      scope,
      organization: organizationRef(clientId),
      members: async () => {
        reads += 1;
        return members;
      },
    });
    const data = {
      runtime: { scope, cells },
      organizationRef,
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
          createElement(ZeropsDataContext.Provider, { value: data }, createElement(Probe)),
        ),
      );
    });
    return { reads: () => reads, last: () => seen.at(-1)! };
  }

  it("a load with a kept verdict reads no member list", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect([hq.reads(), hq.last().hq]).toEqual([
      1,
      { kind: "official", projectId: "P_NEW", address: "https://new.example.test" },
    ]);
  });

  it("an outage of more than ten minutes reads the member list once", async () => {
    const HQ = { projectId: "P_HQ", address: "https://hq.example.test" };
    keepHqVerdict({ account: scope.account, clientId: "org-out" }, HQ);
    const hq = await rendered(
      "org-out",
      [anchor("P_HQ", "https://hq.example.test")],
      Date.now() - 11 * 60_000,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Read once for this outage, the same HQ kept again, and not read again while it lasts.
    expect([hq.reads(), hq.last().hq]).toEqual([1, { kind: "official", ...HQ }]);
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
  let stored: Map<string, string>;
  /** This test's run: the page remembers every token it ended, so no two tests share one. */
  let run = 0;
  /** The `n`th session HQ issued in this test. */
  const issuedSession = (n: number) => `session-${String(run)}-${String(n)}`;

  beforeEach(() => {
    run += 1;
    calls = [];
    lifetimeMs = 12 * HOUR_MS;
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
  });
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

  it("a sign-out revokes HQ's session and forgets it", async () => {
    await accountHqApi(load().client, "org-1", HQ).structure();

    closeAccountLifetime();

    expect(calls.at(-1)).toEqual({
      method: "DELETE",
      path: "/api/session",
      authorization: `Bearer ${issuedSession(1)}`,
    });
    expect([...stored.keys()].filter((key) => key.endsWith(":hq-sessions.v1"))).toEqual([]);
    // Signed in again, nothing is kept: the next load comes through the door.
    openAccountLifetime("person-1");
    const next = load();
    await accountHqApi(next.client, "org-1", HQ).structure();
    expect(next.doors()).toBe(1);
  });
});
