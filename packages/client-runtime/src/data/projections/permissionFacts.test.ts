import { describe, expect, it } from "vite-plus/test";

import { liveProjects, ORG } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectOperator } from "./permissionFacts.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

/** The person `member` of `orgRole`, with `override` on project `p1` where named. */
const read = (orgRole: string, override?: string) =>
  readsOfState(
    apply(emptyAccount, [
      ...membershipInputs(orgRole),
      ...liveProjects(ORG, [
        {
          id: "p1",
          ...(override === undefined
            ? {}
            : { userRoles: [{ clientUserId: "member", roleCode: override }] }),
        },
      ]),
    ]),
  );

describe("projectOperator", () => {
  it.each([
    ["Basic user by the organization", read("BASIC_USER"), "p1", true],
    ["Read only by the organization", read("READ_ONLY"), "p1", false],
    ["an admin overridden to Read only there", read("ADMIN", "READ_ONLY"), "p1", false],
    ["Read only raised to Basic user there", read("READ_ONLY", "BASIC_USER"), "p1", true],
    ["a project Zerops does not list them", read("OWNER"), "gone", false],
    ["nobody before Zerops is read", readsOfState(emptyAccount), "p1", undefined],
  ])(
    "A person works in a project as Basic user or above there, from Zerops' own read: %s",
    (_label, reads, projectId, operates) => {
      expect(projectOperator.derive(reads, { orgId: ORG, projectId })).toBe(operates);
    },
  );
});
