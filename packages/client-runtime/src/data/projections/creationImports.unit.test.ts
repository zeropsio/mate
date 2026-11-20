import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { creationImports } from "./creationImports.ts";

// witness: packages/client-runtime/src/data/projections/creationImports.ts | if (press.kind === "known") imports[id] = press.value.importProcessId ?? imports[id] ?? null; → if (press.kind === "known") imports[id] = press.value.importProcessId ?? null;
it("PJ99: A press without an import handle never erases the import its open birth accepted; breaks: a Mate being set up loses its accepted import and follows no process while a person's press is held", () => {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "app",
          name: "App",
          projects: [],
          births: [{ id: "birth", face: "", projectId: "p1", importProcessId: "accepted" }],
        },
      ],
      ungrouped: [],
    },
    presses: { p1: { kind: "mate", held: true } },
  });
  expect(creationImports.derive(readsOfState(store.state()), ORG)).toEqual({ p1: "accepted" });
  store.close();
});
