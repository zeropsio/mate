import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { recordedEnvironment } from "./recordedEnvironment.ts";

const ENVIRONMENT = {
  id: "p-stage",
  target: { kind: "zerops", projectId: "p-stage" },
  projectId: "p-stage",
  tier: "stage",
  name: "stage",
  sources: [],
  order: 0,
  keyHeld: false,
  keyInvalid: false,
  can: {},
  jobs: [],
  release: null,
  birth: null,
};

// witness: packages/client-runtime/src/zerops/deployToken.ts | return environment.keyHeld && !environment.keyInvalid; → return environment.keyHeld;
it("PJ47: An environment whose key HQ found broken is not keyed", () => {
  const store = makeAccountStore(AtomRegistry.make());
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "app-1",
          name: "Shop",
          projects: [],
          births: [],
          environments: [{ ...ENVIRONMENT, keyHeld: true, keyInvalid: true }],
        },
      ],
      ungrouped: [],
    } as never,
  });
  expect(
    recordedEnvironment.derive(readsOfState(store.state()), {
      orgId: ORG,
      appId: "app-1",
      projectId: "p-stage",
    }),
  ).toEqual({ kind: "recorded", name: "stage", keyed: false });
});
