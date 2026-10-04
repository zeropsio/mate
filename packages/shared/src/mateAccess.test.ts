import { describe, expect, it } from "vite-plus/test";

import { projectAccess, type ZeropsOrgMember } from "./mateAccess.ts";

const member = (userId: string, orgRole: string, patch: Partial<ZeropsOrgMember> = {}) => ({
  clientUserId: `cu-${userId}`,
  userId,
  orgRole,
  status: "ACTIVE",
  canCreateProjects: false,
  ...patch,
});

/**
 * Who a Mate's project opens for and whom it lists, by the door's rule over every row of the
 * member list — an integration token's row among them, as the member list carries it.
 */
describe("projectAccess", () => {
  it.each([
    {
      name: "an owner, open",
      member: member("u-own", "OWNER"),
      override: undefined,
      want: { role: "OWNER", visibility: "open" },
    },
    {
      name: "a token with a role, open",
      member: member("t-admin", "ADMIN"),
      override: undefined,
      want: { role: "ADMIN", visibility: "open" },
    },
    {
      name: "a read-only member, listed",
      member: member("u-read", "READ_ONLY"),
      override: undefined,
      want: { role: "READ_ONLY", visibility: "listed" },
    },
    {
      name: "a member raised on the project",
      member: member("u-dev", "NO_ACCESS"),
      override: "BASIC_USER",
      want: { role: "BASIC_USER", visibility: "open" },
    },
    {
      name: "an owner lowered on the project",
      member: member("u-low", "OWNER"),
      override: "NO_ACCESS",
      want: undefined,
    },
    {
      name: "a role this build does not know",
      member: member("u-new", "SUPERUSER"),
      override: undefined,
      want: undefined,
    },
    {
      name: "an invited admin",
      member: member("u-inv", "ADMIN", { status: "INVITED" }),
      override: undefined,
      want: undefined,
    },
    {
      name: "a row naming nobody",
      member: member("", "OWNER"),
      override: undefined,
      want: undefined,
    },
    {
      name: "an override on no member row",
      member: member("u-blank", "NO_ACCESS", { clientUserId: "" }),
      override: "OWNER",
      want: undefined,
    },
  ])("$name", ({ member: row, override, want }) => {
    const access = projectAccess({
      projectId: "P",
      members: [row],
      overrides: override === undefined ? {} : { [row.clientUserId]: override },
    });
    expect(access).toEqual(want === undefined ? [] : [{ userId: row.userId, ...want }]);
  });
});
