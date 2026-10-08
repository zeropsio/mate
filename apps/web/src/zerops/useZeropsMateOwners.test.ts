import { act, createElement, StrictMode } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import { AtomRegistry } from "effect/reactivity";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

import { makeMemberAccount } from "./__fixtures__/sampledAccount";
import { AccountDataContext } from "./ZeropsAccountData";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import {
  useWaitsOnViewer,
  useZeropsMateOwners,
  useHqPersonNames,
  useZeropsOrganizationMembersRead,
  zeropsMateOwnerOf,
} from "./useZeropsMateOwners";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { accountReadsAtom, makeAccountStore } from "@t3tools/client-runtime/data";
import { seedHqProjectPeople } from "@t3tools/client-runtime/data/fixtures";

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-1" }, user: { id: "u-eva" } }),
}));

describe("zeropsMateOwnerOf", () => {
  // HQ names the person and sends their platform picture.
  it.each([
    { case: "their picture", avatarUrl: "https://img/jan.png" },
    { case: "initials where they have no picture", avatarUrl: null },
  ])("is the person's name, initials and $case", ({ avatarUrl }) => {
    expect(zeropsMateOwnerOf({ userId: "u-jan", name: "Jan Novák", avatarUrl })).toEqual({
      name: "Jan Novák",
      initials: "JN",
      avatarUrl,
      isViewer: false,
    });
  });

  it.each([
    { viewer: "u-jan", isViewer: true },
    { viewer: "u-ada", isViewer: false },
    { viewer: undefined, isViewer: false },
  ])("says whether the owner is the one looking: $viewer", ({ viewer, isViewer }) => {
    const jan = { userId: "u-jan", name: "Jan Novák", avatarUrl: null };
    expect(zeropsMateOwnerOf(jan, viewer)?.isViewer).toBe(isViewer);
  });

  it("is nobody where HQ names nobody", () => {
    expect(zeropsMateOwnerOf(null, "u-jan")).toBeUndefined();
    expect(zeropsMateOwnerOf(undefined, "u-jan")).toBeUndefined();
  });
});

// A login's signer is a Zerops user id; the member list turns it into
// the name the coding-agents card shows ("Signed in by Cleo").
describe("useZeropsOrganizationMembersRead", () => {
  it("is one read of the organization's members, however many surfaces ask at once", async () => {
    const scope: AccountScope = {
      account: {
        apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
        accountId: ZeropsAccountId.make("account-a"),
      },
      epoch: AccountEpoch.make(1),
    };
    let reads = 0;
    const registry = AtomRegistry.make();
    const account = makeMemberAccount({
      registry,
      orgId: "org-1",
      members: async () => {
        reads += 1;
        return [{ id: "cu-jan", user: { fullName: "Jan Novák" } }] as never;
      },
    });
    const data = { scope } as unknown as ZeropsDataContextValue;
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
            { value: registry },
            createElement(
              ZeropsDataContext.Provider,
              { value: data },
              createElement(
                AccountDataContext.Provider,
                { value: account.value },
                createElement(Probe),
                createElement(Probe),
                createElement(Probe),
                createElement(Probe),
              ),
            ),
          ),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(seen.at(-1)?.status).toBe("ready"));
    });
    expect(seen.at(-1)?.status).toBe("ready");
    expect(seen.at(-1)?.members).toHaveLength(1);
    expect(reads).toBe(1);
  });
});

describe("useZeropsMateOwners", () => {
  it("draws each Mate's owner as HQ names them, with HQ's picture, reading no member list", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: "org-1",
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    seedHqProjectPeople(store, "org-1", {
      projects: { "p-vera": { ownerUserId: "u-eva" }, "p-lone": { ownerUserId: null } },
      people: {
        "u-eva": { name: "Eva Dvořák", avatarUrl: "https://storage.example.test/eva.jpg" },
      },
    });
    const candidate = (id: string) => ({ project: { id } }) as unknown as ZeropsCandidate;
    const owners: Array<ReadonlyArray<ReturnType<ReturnType<typeof useZeropsMateOwners>>>> = [];
    function Probe() {
      const ownerOf = useZeropsMateOwners();
      owners.push([ownerOf(candidate("p-vera")), ownerOf(candidate("p-lone"))]);
      return null;
    }
    await act(async () => {
      create(createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)));
    });
    expect(owners.at(-1)).toEqual([
      {
        name: "Eva Dvořák",
        initials: "ED",
        avatarUrl: "https://storage.example.test/eva.jpg",
        isViewer: true,
      },
      undefined,
    ]);
  });
});

describe("useWaitsOnViewer", () => {
  it.each([
    { case: "HQ says it waits on the viewer", projectId: "p-own", waits: true },
    { case: "HQ says it waits on someone else", projectId: "p-other", waits: false },
    { case: "HQ says nothing of it", projectId: "p-unknown", waits: false },
  ])("$case: $waits", async ({ projectId, waits }) => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: "org-1",
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    seedHqProjectPeople(store, "org-1", {
      projects: { "p-own": { waitsOnViewer: true }, "p-other": { waitsOnViewer: false } },
    });
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useWaitsOnViewer()(projectId));
      return null;
    }
    await act(async () => {
      create(createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)));
    });
    expect(seen.at(-1)).toBe(waits);
  });
});

// Who signed a login in, who said a remark: as HQ's people name them for the organization in view,
// whether HQ answers now or not (its last word stands); nobody of another organization, and no
// member list is read for it.
describe("useHqPersonNames", () => {
  it.each([
    ["HQ answers for it", "org-1", true, "Cleo as HQ names her"],
    ["its HQ is down", "org-1", false, "Cleo as HQ names her"],
    ["another organization", "org-2", true, undefined],
  ] as const)("names Cleo where %s", async (_case, clientId, live, name) => {
    const registry = AtomRegistry.make();
    mountHqNavigation(registry, "org-1", {
      people: { "u-cleo": { name: "Cleo as HQ names her" } },
      live,
    });
    const named: Array<string | undefined> = [];
    function Probe() {
      named.push(useHqPersonNames(clientId)("u-cleo"));
      return null;
    }
    await act(async () => {
      create(createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)));
    });
    expect(named.at(-1)).toBe(name);
  });
});
