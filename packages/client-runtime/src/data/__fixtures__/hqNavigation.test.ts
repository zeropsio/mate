import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { hqAppsScope } from "../families/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { seedHqNavigation } from "./hqNavigation.ts";

it("seeding another account does not make this account's later HQ update stale", () => {
  const firstRegistry = AtomRegistry.make();
  const secondRegistry = AtomRegistry.make();
  const first = makeAccountStore(firstRegistry);
  const second = makeAccountStore(secondRegistry);
  const seed = (store: typeof first, name: string) =>
    seedHqNavigation(store, "org", {
      structure: { apps: [{ id: "shop", name, projects: [] }], ungrouped: [] },
    });

  try {
    seed(first, "One");
    seed(first, "Two");
    expect(readsOfState(first.state()).fact("hqApp", "shop")).toMatchObject({
      kind: "known",
      value: { name: "Two" },
    });

    seed(second, "Before");
    const app = readsOfState(second.state()).fact("hqApp", "shop");
    if (app.kind !== "known") throw new Error("Expected the seeded application");
    const scope = hqAppsScope("org");
    second.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: second.state().streams.get(scope)!.generation }],
      reset: false,
      removals: [],
      rows: [
        {
          family: "hqApp",
          id: "shop",
          value: { ...app.value, name: "After" },
          revision: { kind: "hq", incarnation: "seed", revision: 2 },
        },
      ],
    });
    expect(readsOfState(second.state()).fact("hqApp", "shop")).toMatchObject({
      kind: "known",
      value: { name: "After" },
    });
  } finally {
    first.close();
    second.close();
    firstRegistry.dispose();
    secondRegistry.dispose();
  }
});
