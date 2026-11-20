import { expect, it } from "vite-plus/test";

import { liveProjects } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateVisibility } from "./mateVisibility.ts";

const stateOf = (inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
const verdict = (inputs: ReadonlyArray<AccountInput>, projectId = "mate") =>
  mateVisibility.derive(readsOfState(stateOf(inputs)), { orgId: "org", projectId });
const granted = (
  role: string,
  userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>,
) => verdict([...liveProjects("org", [{ id: "mate", userRoles }]), ...membershipInputs(role)]);

// witness: packages/shared/src/zeropsRoles.ts | read: "listed", → read: "open",
it("PJ32: A Mate is open to a member who is Basic user or above on its project and only listed to anyone else; breaks: a Read-only or demoted person is offered Open and the door refuses", () => {
  expect(granted("READ_ONLY", [])).toBe("listed");
  expect(granted("BASIC_USER", [])).toBe("open");
  expect(granted("READ_ONLY", [{ clientUserId: "member", roleCode: "BASIC_USER" }])).toBe("open");
  expect(granted("OWNER", [{ clientUserId: "member", roleCode: "NO_ACCESS" }])).toBe("listed");
});
