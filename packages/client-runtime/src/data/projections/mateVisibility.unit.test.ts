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

// witness: packages/shared/src/zeropsRoles.ts | if (roleAtLeast(role, "BASIC_USER")) return "open"; → if (roleAtLeast(role, "READ_ONLY")) return "open";
it("PJ32: A Mate is open to a member who is Basic user or above on its project, only listed to one who is Read only there, and hidden from one the project gives no access", () => {
  expect(granted("READ_ONLY", [])).toBe("listed");
  expect(granted("BASIC_USER", [])).toBe("open");
  expect(granted("READ_ONLY", [{ clientUserId: "member", roleCode: "BASIC_USER" }])).toBe("open");
  expect(granted("OWNER", [{ clientUserId: "member", roleCode: "NO_ACCESS" }])).toBe("hidden");
});

// witness: packages/client-runtime/src/data/projections/mateVisibility.ts | if (roster.ids.includes(projectId)) → if (fact.kind === "known")
it("PJ33: A Mate whose project the person's whole roster lacks is hidden; one whose project row is not known yet is unknown, never hidden", () => {
  expect(
    verdict([...liveProjects("org", [{ id: "other" }]), ...membershipInputs("NO_ACCESS")]),
  ).toBe("hidden");
  const rowless = liveProjects("org", [{ id: "mate" }]).map((input) =>
    input.kind === "baseline-commit" ? { ...input, rows: [] } : input,
  );
  expect(verdict([...rowless, ...membershipInputs("NO_ACCESS")])).toBe("unknown");
});
