import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import {
  accountReadsAtom,
  shownHqListedMateIdentitiesAtom,
  shownHqListedMatesAtom,
  shownHqListNavigationAtom,
  shownHqMateDirectoryAtom,
} from "../reads.ts";
import { makeAccountStore } from "../store.ts";
import { hqListedMateIdentities, isListedMateEnvironment } from "./hqMateDirectory.ts";
import { hqMateIdentities } from "./hqMateIdentity.ts";
import { hqMateOverview } from "./hqMates.ts";

const ORG = "orchard";
const person = {
  mine: true,
  ownerUserId: "person",
  waitsOnViewer: false,
  unseen: null,
} as const;

/** An organization with an ordinary Mate and the viewer's own Chief, as HQ's navigation holds them. */
const seeded = () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "work",
          name: "Work",
          projects: [
            { projectId: "ordinary", name: "Work - Ada", kind: "mate", mate: { face: "" } },
          ],
        },
        {
          id: "personal",
          name: "Chief · Person",
          projects: [{ projectId: "chief", name: "Chief", kind: "mate", mate: { face: "" } }],
        },
      ],
      ungrouped: [],
    },
    person,
    mates: {
      chief: {
        presence: { online: true, since: "2026-10-14T00:00:00Z", overview: "live" },
        identity: {
          environmentId: EnvironmentId.make("chief-env"),
          serverVersion: "1",
          update: null,
        },
      },
    },
  });
  const scope = placementsScope(ORG);
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
    reset: false,
    removals: [],
    rows: [
      {
        family: "placement",
        id: "chief",
        revision: { kind: "hq", incarnation: "seed", revision: 100 },
        value: {
          projectId: "chief",
          appId: "personal",
          name: "Chief",
          kind: "mate",
          mate: { face: "" },
          person: { ...person, chief: "mine" },
        },
      },
    ],
  });
  const show = (orgId: string | null = ORG) =>
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
  return { registry, store, show };
};

// witness: packages/client-runtime/src/data/projections/hqMateDirectory.ts | mates: Object.fromEntries(Object.entries(placements).filter(([id]) => !chiefs.has(id))), → mates: placements,
it("PJ40: No Mate list holds a Chief: the viewer's own Chief reaches the header alone", () => {
  const { registry, store, show } = seeded();
  expect(Object.keys(registry.get(store.data.project(hqListedMateIdentities, ORG)))).toEqual([
    "ordinary",
  ]);
  show();
  expect(registry.get(shownHqMateDirectoryAtom).myChief).toMatchObject({
    kind: "present",
    projectId: "chief",
  });
  expect(Object.keys(registry.get(shownHqMateDirectoryAtom).mates)).toEqual(["ordinary"]);
  expect(registry.get(shownHqListNavigationAtom).structure?.apps.map((app) => app.id)).toEqual([
    "work",
  ]);
  expect(Object.keys(registry.get(shownHqListedMateIdentitiesAtom))).toEqual(["ordinary"]);
  expect(registry.get(shownHqListedMatesAtom).mates).toEqual({});
  expect(registry.get(store.data.project(hqMateIdentities, ORG)).chief?.name).toBe("Chief");
  expect(
    registry.get(store.data.project(hqMateOverview, { orgId: ORG, projectId: "chief" }))?.identity
      ?.environmentId,
  ).toBe("chief-env");
  expect(
    isListedMateEnvironment(
      registry.get(shownHqMateDirectoryAtom),
      EnvironmentId.make("chief-env"),
    ),
  ).toBe(false);
  store.close();
  registry.dispose();
});
