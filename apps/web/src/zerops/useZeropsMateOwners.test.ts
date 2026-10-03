import { act, createElement, StrictMode } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type AccountScope,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import { AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

import { hqPeopleViewAtom, hqStructureAtom, zeropsSessionAtom } from "../state/zerops";
import { makeMemberCells } from "./__fixtures__/memberCells";
import { keepHqVerdict, keepNoHqVerdict } from "./hqVerdict";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import {
  useZeropsMateOwners,
  useZeropsMemberNames,
  useZeropsOrganizationMembersRead,
  zeropsMateOwnerOf,
  zeropsMemberNameByUserId,
} from "./useZeropsMateOwners";

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-1" }, user: { id: "u-eva" } }),
}));

describe("zeropsMateOwnerOf", () => {
  it("is the person's name and its initials: HQ keeps no picture", () => {
    expect(zeropsMateOwnerOf({ userId: "u-jan", name: "Jan Novák" })).toEqual({
      name: "Jan Novák",
      initials: "JN",
      avatarUrl: null,
      isViewer: false,
    });
  });

  it.each([
    { viewer: "u-jan", isViewer: true },
    { viewer: "u-ada", isViewer: false },
    { viewer: undefined, isViewer: false },
  ])("says whether the owner is the one looking: $viewer", ({ viewer, isViewer }) => {
    expect(zeropsMateOwnerOf({ userId: "u-jan", name: "Jan Novák" }, viewer)?.isViewer).toBe(
      isViewer,
    );
  });

  it("is nobody where HQ names nobody", () => {
    expect(zeropsMateOwnerOf(undefined, "u-jan")).toBeUndefined();
  });
});

// A login's signer is a Zerops user id; the member list turns it into
// the name the coding-agents card shows ("Signed in by Cleo").
describe("zeropsMemberNameByUserId", () => {
  const members = [
    { id: "cu-cleo", user: { id: "u-cleo", fullName: "Cleo Dvořák" } },
    { id: "cu-quiet", user: { id: "u-quiet", email: "quiet@example.com" } },
    { id: "cu-blank", user: { id: "u-blank" } },
  ];

  it.each([
    ["u-cleo", "Cleo Dvořák"],
    ["u-quiet", "quiet@example.com"],
    ["u-blank", undefined],
    ["u-left", undefined],
  ])("%s is %s", (userId, name) => {
    expect(zeropsMemberNameByUserId(members, userId)).toBe(name);
  });
});

describe("useZeropsOrganizationMembersRead", () => {
  it("is one read of the organization's members, however many surfaces ask at once", async () => {
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
    let reads = 0;
    const cells = await makeMemberCells({
      scope,
      organization: organizationRef("org-1"),
      members: async () => {
        reads += 1;
        return [{ id: "cu-jan", user: { fullName: "Jan Novák" } }] as never;
      },
    });
    const data = {
      runtime: { scope, cells },
      organizationRef,
    } as unknown as ZeropsDataContextValue;
    const seen: Array<ReturnType<typeof useZeropsOrganizationMembersRead>> = [];
    function Probe() {
      seen.push(useZeropsOrganizationMembersRead({ clientId: "org-1", enabled: true }));
      return null;
    }
    await act(async () => {
      create(
        createElement(
          StrictMode,
          null,
          createElement(
            RegistryContext.Provider,
            { value: AtomRegistry.make() },
            createElement(
              ZeropsDataContext.Provider,
              { value: data },
              createElement(Probe),
              createElement(Probe),
              createElement(Probe),
              createElement(Probe),
            ),
          ),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(seen.at(-1)?.status).toBe("ready");
    expect(seen.at(-1)?.members).toHaveLength(1);
    expect(reads).toBe(1);
  });
});

describe("useZeropsMateOwners", () => {
  it("names an owner without reading the member list", async () => {
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
    let reads = 0;
    const cells = await makeMemberCells({
      scope,
      organization: organizationRef("org-1"),
      members: async () => {
        reads += 1;
        return [] as never;
      },
    });
    const data = {
      runtime: { scope, cells },
      organizationRef,
    } as unknown as ZeropsDataContextValue;
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organizationRef("org-1"),
    });
    // HQ names the people the view names: Eva, who signed Vera's agent in.
    registry.set(hqPeopleViewAtom, {
      organizationId: "org-1",
      people: { "u-eva": { name: "Eva Dvořák" } },
    });
    const vera = {
      key: "p-vera:zcp",
      project: {
        id: "p-vera",
        name: "Acme - Vera",
        status: "ACTIVE",
        hq: {
          appId: null,
          appName: null,
          kind: "mate",
          mate: {
            name: "Vera",
            face: "",
            logins: { "claude-code": { signedInBy: "u-eva", present: true, token: false } },
          },
        },
      },
      group: "connected",
    } as unknown as ZeropsCandidate;
    const owners: Array<ReturnType<ReturnType<typeof useZeropsMateOwners>>> = [];
    function Probe() {
      owners.push(useZeropsMateOwners()(vera));
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(owners.at(-1)).toEqual({
      name: "Eva Dvořák",
      initials: "ED",
      avatarUrl: null,
      isViewer: true,
    });
    expect(reads).toBe(0);
  });
});

// Who signed a login in, who said a remark: HQ's people name them where HQ has word for the
// organization; the member list is read only where it has none.
describe("useZeropsMemberNames", () => {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-names"),
    },
    epoch: AccountEpoch.make(1),
  };
  const organizationRef = (organizationId: string): OrganizationRef => ({
    kind: "organization",
    account: scope.account,
    organizationId: ZeropsOrganizationId.make(organizationId),
  });
  const HQ = { projectId: "P_HQ", address: "https://hq.example.test" };

  // This browser's storage, for the HQ verdict it keeps.
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

  it.each([
    ["HQ answers for it", "official", null, "Cleo as HQ names her", 0],
    ["its HQ is down", "official", 1_000, "Cleo Dvořák", 1],
    ["it has no official HQ", "none", null, "Cleo Dvořák", 1],
  ] as const)("names Cleo where %s", async (_case, verdict, unavailableSince, name, reads) => {
    const clientId = `org-${verdict}-${String(unavailableSince)}`;
    const owner = { account: scope.account, clientId };
    if (verdict === "official") keepHqVerdict(owner, HQ);
    else keepNoHqVerdict(owner, Date.now());
    let read = 0;
    const cells = await makeMemberCells({
      scope,
      organization: organizationRef(clientId),
      members: async () => {
        read += 1;
        return [{ id: "cu-cleo", user: { id: "u-cleo", fullName: "Cleo Dvořák" } }] as never;
      },
    });
    const data = {
      runtime: { scope, cells },
      organizationRef,
    } as unknown as ZeropsDataContextValue;
    const registry = AtomRegistry.make();
    registry.set(hqStructureAtom, {
      organizationId: clientId,
      structure: null,
      changes: null,
      releaseRevisions: null,
      readAt: null,
      current: unavailableSince === null,
      unavailableSince,
    });
    registry.set(hqPeopleViewAtom, {
      organizationId: clientId,
      people: { "u-cleo": { name: "Cleo as HQ names her" } },
    });
    const named: Array<string | undefined> = [];
    function Probe() {
      named.push(useZeropsMemberNames({ clientId, enabled: true })("u-cleo"));
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect([named.at(-1), read]).toEqual([name, reads]);
  });
});
