import { expect, it } from "vite-plus/test";

import { liveProjects, ORG } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectOperator } from "./permissionFacts.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

/** Whether the person `member` of `orgRole`, with `override` on project `p1` where named, works in `p1`. */
const operates = (orgRole: string, override?: string) =>
  projectOperator.derive(
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
    ),
    { orgId: ORG, projectId: "p1" },
  );

// witness: packages/shared/src/zeropsPermissions.ts | return roleAtLeast(roleOn(facts, member, projectId), "BASIC_USER") → return roleAtLeast(roleOn(facts, member, projectId), "READ_ONLY")
it("PJ31: A person works in a project only as Basic user or above there: an Admin overridden to Read only does not, a Read-only member raised to Basic user does", () => {
  expect(operates("BASIC_USER")).toBe(true);
  expect(operates("READ_ONLY")).toBe(false);
  expect(operates("ADMIN", "READ_ONLY")).toBe(false);
  expect(operates("READ_ONLY", "BASIC_USER")).toBe(true);
});
