import { act, createElement, StrictMode } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

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

import { makeMemberCells } from "./__fixtures__/memberCells";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
import {
  useZeropsOrganizationMembersRead,
  zeropsMateOwner,
  zeropsMemberNameByUserId,
} from "./useZeropsMateOwners";

describe("zeropsMateOwner", () => {
  it("is the member's name and the picture the account bar would pick", () => {
    expect(
      zeropsMateOwner({
        id: "cu-jan",
        user: {
          fullName: "Jan Novák",
          avatar: { smallAvatarUrl: null, externalAvatarUrl: "https://cdn/jan.png" },
        },
      }),
    ).toEqual({
      name: "Jan Novák",
      initials: "JN",
      avatarUrl: "https://cdn/jan.png",
      isViewer: false,
    });
  });

  it.each([
    { viewer: "u-jan", isViewer: true },
    { viewer: "u-ada", isViewer: false },
    { viewer: undefined, isViewer: false },
  ])("says whether the owner is the one looking: $viewer", ({ viewer, isViewer }) => {
    expect(
      zeropsMateOwner({ id: "cu-jan", user: { id: "u-jan", fullName: "Jan Novák" } }, viewer)
        ?.isViewer,
    ).toBe(isViewer);
  });

  it("falls back to initials, and to an e-mail for a name", () => {
    expect(zeropsMateOwner({ id: "cu-q", user: { email: "quiet@example.com" } })).toEqual({
      name: "quiet@example.com",
      initials: "Q",
      avatarUrl: null,
      isViewer: false,
    });
  });

  for (const [name, member] of [
    ["no member at all", undefined],
    ["a member with no user record", { id: "cu-x" }],
    ["a member the platform names nowhere", { id: "cu-blank", user: {} }],
  ] as const) {
    it(`is nobody for ${name}`, () => {
      expect(zeropsMateOwner(member)).toBeUndefined();
    });
  }
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
