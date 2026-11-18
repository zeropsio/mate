import { expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectsGrants } from "./projectGrants.ts";

// witness: packages/client-runtime/src/data/projections/projectGrants.ts | grants = fact.value.userRoles; → grants = fact.value.userRoles ?? [];
it("PJ37: A project that is only listed names nobody's grants yet: its grants read as reading, never as none", () => {
  const listed = liveZerops({ running: [], projects: [{ id: "p" }] }).reduce(
    (current, input) => reduceAccount(current, input).state,
    emptyAccount,
  );
  expect(
    projectsGrants.derive(readsOfState(listed), { orgId: ORG, projectIds: ["p"] })["p"],
  ).toEqual({ grants: undefined, status: "loading" });
});
