import { act, createElement, StrictMode } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

import { zeropsSessionAtom } from "../state/zerops";
import { makeMemberCells } from "./__fixtures__/memberCells";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import {
  useZeropsMateOwners,
  useHqPersonNames,
  useZeropsOrganizationMembersRead,
  zeropsMateOwnerOf,
} from "./useZeropsMateOwners";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-1" }, user: { id: "u-eva" } }),
}));

describe("zeropsMateOwnerOf", () => {
  // HQ names the person; their picture is the platform's, off the member list by user id.
  it.each([
    {
      case: "the member's picture",
      members: [
        { id: "cu-jan", user: { id: "u-jan", avatar: { smallAvatarUrl: "https://img/jan.png" } } },
      ],
      avatarUrl: "https://img/jan.png",
    },
    {
      case: "initials where the member has no picture",
      members: [{ id: "cu-jan", user: { id: "u-jan", avatar: null } }],
      avatarUrl: null,
    },
    {
      case: "initials where the list does not have them",
      members: [
        { id: "cu-ada", user: { id: "u-ada", avatar: { smallAvatarUrl: "https://img/ada.png" } } },
      ],
      avatarUrl: null,
    },
    { case: "initials before the list is read", members: [], avatarUrl: null },
  ])("is the person's name, initials and $case", ({ members, avatarUrl }) => {
    expect(zeropsMateOwnerOf({ userId: "u-jan", name: "Jan Novák" }, undefined, members)).toEqual({
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
  it("names an owner from HQ and wears their platform picture, off one member read", async () => {
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
        // The platform knows Eva by another name; the badge keeps HQ's, and takes her picture.
        return [
          {
            id: "cu-eva",
            user: {
              id: "u-eva",
              fullName: "Eva D.",
              avatar: { smallAvatarUrl: "https://storage.example.test/eva-small.jpg" },
            },
          },
        ];
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
    mountHqNavigation(registry, "org-1", { people: { "u-eva": { name: "Eva Dvořák" } } });
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
      avatarUrl: "https://storage.example.test/eva-small.jpg",
      isViewer: true,
    });
    expect(reads).toBe(1);
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
