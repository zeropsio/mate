import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import type { HqBirth } from "../../zerops/hq/client.ts";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import {
  initialContainer,
  probeCadence,
  transitionContainer,
} from "../../zerops/environments/index.ts";
import { hqMateLink } from "./hqMates.ts";
import { mateRecovery } from "./mateRecovery.ts";

const key = { orgId: ORG, projectId: "p", serviceId: "s" };

// witness: packages/client-runtime/src/data/projections/mateRecovery.ts | const linked = hqMatePresence.derive(read, key)?.online === true; → const linked = false;
it("PJ112: A Mate HQ says is linked is never said to have failed because Zerops marks its service FAILED, and one with no link is offered its restart; breaks: a working Mate's page hides its conversation behind \"couldn't restart\" (2026-11-20, 16 Mates)", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    projects: [{ id: "p" }],
    services: [{ id: "s", projectId: "p", status: "FAILED" }],
    running: [
      {
        id: "failed-restart",
        projectId: "p",
        serviceStackIds: ["s"],
        actionName: "stack.restart",
        status: "FAILED",
      },
    ],
  }).forEach(store.dispatch);
  const linked = (online: boolean) =>
    seedHqNavigation(store, ORG, {
      mates: { p: { presence: { online, since: "2026-11-20T20:04:30Z", overview: "none" } } },
    });
  const read = () => registry.get(store.data.project(mateRecovery, key));

  linked(true);
  expect(read().status).toBe("FAILED");
  expect(read().lifecycle).toBeUndefined();

  linked(false);
  expect(read().lifecycle?.state).toBe("failed");
  expect(read().lifecycle?.actions).toContain("restart");
  registry.dispose();
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | if (machine.hq === "coming" || platformSaysDown(machine)) return { kind: "none" }; → if (platformSaysDown(machine)) return { kind: "none" };
it("PJ+1: A new Mate's container is not read while HQ holds its birth open with no link, and is read once as HQ says it linked; breaks: the page fills with failed requests for the minutes its container starts", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const link = () => registry.get(store.data.project(hqMateLink, { orgId: ORG, projectId: "p" }));
  const now = { wall: 1_000, mono: 1_000 };
  const hear = (machine: ReturnType<typeof initialContainer>) =>
    transitionContainer(machine, { type: "HQ", presence: link() }, { now, watched: true });
  const birth: HqBirth = {
    id: "b",
    projectId: "p",
    face: "rose:seal",
    madeBy: "ada",
    intent: {
      projectName: "Shop - Ada",
      recipe: { kind: "none" },
      agents: ["codex"],
      standUp: false,
      automated: false,
      placement: { role: "dev", name: "Ada", chief: false },
      location: null,
      userRoles: [],
    },
    operation: {
      kind: "birth",
      phase: "accepted",
      acceptedAt: "2026-11-23T21:48:31Z",
      at: "2026-11-23T21:48:31Z",
    },
    state: "running",
    offers: ["delete"],
  };
  const app = { id: "a", name: "Shop", projects: [] };

  seedHqNavigation(store, ORG, {
    structure: { apps: [{ ...app, births: [birth] }], ungrouped: [] },
  });
  const coming = hear(initialContainer());
  expect(probeCadence(coming.state, true)).toEqual({ kind: "none" });

  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          ...app,
          projects: [
            { projectId: "p", name: "Shop - Ada", kind: "mate", mate: { face: "rose:seal" } },
          ],
          births: [],
        },
      ],
      ungrouped: [],
    },
    mates: { p: { presence: { online: true, since: "2026-11-23T21:50:39Z", overview: "none" } } },
  });
  expect(hear(coming.state).effects.map((effect) => effect.kind)).toContain("probe");
  registry.dispose();
});
