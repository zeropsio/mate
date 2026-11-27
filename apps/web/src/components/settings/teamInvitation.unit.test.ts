import { expect, it } from "vite-plus/test";

import { invitationChange } from "./teamMember.logic.ts";

// witness: apps/web/src/components/settings/teamMember.logic.ts | names: input.names, → names: undefined,
it("TI+1: An invitation carries the typed names, membership and project grants to HQ, so HQ can invite an address without an existing account", () => {
  const names = { firstName: "Ada", lastName: "Lovelace" };
  const membership = {
    roleCode: "NO_ACCESS",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
  } as const;
  const grants = [{ projectId: "project-1", roleCode: "READ_ONLY" }] as const;

  expect(invitationChange({ email: "ada@example.test", names, membership, grants })).toEqual({
    kind: "invite",
    email: "ada@example.test",
    names,
    membership,
    grants,
  });
  expect(invitationChange({ email: "ada@example.test", names, membership, grants: [] })).toEqual({
    kind: "invite",
    email: "ada@example.test",
    names,
    membership,
  });
});
