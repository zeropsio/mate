import { expect, it } from "vite-plus/test";

import { liveProjects, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { projectsScope } from "../families/project.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { platformInventory } from "./platformInventory.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };

/** Zerops pushing project `p` with the viewer's role on it, at `version`. */
const answer = (roleCode: string, version: number): AccountInput => ({
  kind: "rows",
  scope: projectsScope("org"),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: [
    {
      family: "project",
      id: "p",
      value: projectValue({ id: "p", userRoles: [{ clientUserId: "member", roleCode }] }),
      revision: zeropsVersion(version),
    },
  ],
});
const shownAfter = (answers: ReadonlyArray<AccountInput>) => {
  const state = [...liveProjects("org", [{ id: "p" }]), ...answers].reduce(
    (held, input) => reduceAccount(held, input).state,
    emptyAccount,
  );
  const shown = platformInventory.derive(readsOfState(state), { orgId: "org", viewer });
  return { projects: shown.projects.map(({ id }) => id), denied: shown.denied };
};

// witness: packages/client-runtime/src/data/reducer.ts | return current.version === null || incoming.version > current.version; → return current.version === null || incoming.version !== current.version;
it("PJ34: A project is shown only when the newest role its owner answered permits it, whichever order the answers arrived in", () => {
  // BASIC_USER at 2, NO_ACCESS at 3: denied, in either order.
  expect(shownAfter([answer("BASIC_USER", 2), answer("NO_ACCESS", 3)])).toEqual({
    projects: [],
    denied: ["p"],
  });
  expect(shownAfter([answer("NO_ACCESS", 3), answer("BASIC_USER", 2)])).toEqual({
    projects: [],
    denied: ["p"],
  });
  // NO_ACCESS at 2, BASIC_USER at 3: shown, in either order.
  expect(shownAfter([answer("NO_ACCESS", 2), answer("BASIC_USER", 3)])).toEqual({
    projects: ["p"],
    denied: [],
  });
  expect(shownAfter([answer("BASIC_USER", 3), answer("NO_ACCESS", 2)])).toEqual({
    projects: ["p"],
    denied: [],
  });
});
