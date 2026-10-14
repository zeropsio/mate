import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { initialEnvironment } from "../../zerops/environments/environmentMachine.ts";
import { mateLinkScope } from "../families/mateLink.ts";
import { EnvironmentId } from "@t3tools/contracts";
import { liveProjects } from "../__fixtures__/account.ts";
import {
  accountReadsAtom,
  shownHqMateDirectoryAtom,
  shownHqListNavigationAtom,
  shownMateListProjectsAtom,
  shownHqListedMatesAtom,
  shownHqListedMateIdentitiesAtom,
} from "../reads.ts";
import { hqMateIdentities } from "./hqMateIdentity.ts";
import { hqMateOverview } from "./hqMates.ts";
import { isListedMateEnvironment } from "./hqMateDirectory.ts";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { hqListedMateIdentities } from "./hqMateDirectory.ts";

const ORG = "orchard";
const person = {
  role: "OWNER",
  mayWrite: true,
  mine: true,
  ownerUserId: "person",
  waitsOnViewer: false,
  unseen: null,
} as const;
function makeFixture() {
  const registry = AtomRegistry.make();
  return { registry, store: makeAccountStore(registry) };
}
let fixture: ReturnType<typeof makeFixture>;
beforeEach(() => {
  fixture = makeFixture();
});
afterEach(() => {
  fixture.store.close();
  fixture.registry.dispose();
});
function seed(chief: "mine" | "another" = "mine") {
  seedHqNavigation(fixture.store, ORG, {
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
  fixture.store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: fixture.store.state().streams.get(scope)?.generation ?? 0 }],
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
          person: { ...person, chief },
        },
      },
    ],
  });
}

it("Mate list identities exclude the viewer's Chief at the data layer", () => {
  seed();
  const identities = fixture.registry.get(fixture.store.data.project(hqListedMateIdentities, ORG));
  expect(Object.keys(identities)).toEqual(["ordinary"]);
});

function show(orgId: string | null = ORG) {
  fixture.registry.set(accountReadsAtom, {
    data: fixture.store.data,
    orgId,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
}

it("The header receives my Chief separately while every Mate list excludes Chiefs", () => {
  seed();
  show();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toMatchObject({
    kind: "present",
    projectId: "chief",
  });
  expect(Object.keys(fixture.registry.get(shownHqMateDirectoryAtom).mates)).toEqual(["ordinary"]);
  expect(
    fixture.registry.get(shownHqListNavigationAtom).structure?.apps.map((app) => app.id),
  ).toEqual(["work"]);
  expect(Object.keys(fixture.registry.get(shownHqListedMateIdentitiesAtom))).toEqual(["ordinary"]);
  expect(fixture.registry.get(shownHqListedMatesAtom).mates).toEqual({});
  expect(fixture.registry.get(fixture.store.data.project(hqMateIdentities, ORG)).chief?.name).toBe(
    "Chief",
  );
  expect(
    fixture.registry.get(
      fixture.store.data.project(hqMateOverview, { orgId: ORG, projectId: "chief" }),
    )?.identity?.environmentId,
  ).toBe("chief-env");
  expect(
    isListedMateEnvironment(
      fixture.registry.get(shownHqMateDirectoryAtom),
      EnvironmentId.make("chief-env"),
    ),
  ).toBe(false);
});

it("Another person's Chief from an older Core is never an ordinary Mate", () => {
  seed("another");
  show();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "absent" });
  expect(Object.keys(fixture.registry.get(shownHqListedMateIdentitiesAtom))).toEqual(["ordinary"]);
  expect(
    fixture.registry.get(shownHqListNavigationAtom).structure?.apps.map((app) => app.id),
  ).toEqual(["work"]);
});

it("A tagged Chief being created or failed stays out of the platform Mate list before registration", () => {
  show();
  liveProjects(ORG, [
    { id: "ordinary", tagList: ["mate"] },
    { id: "creating", status: "NEW", tagList: ["mate", "chief"] },
    { id: "failed", status: "NEW", tagList: ["chief"] },
  ]).forEach(fixture.store.dispatch);
  expect(fixture.registry.get(shownMateListProjectsAtom).projects.map(({ id }) => id)).toEqual([
    "ordinary",
  ]);
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "unknown" });
});

it("Chief ownership arriving after first paint updates the header and all ordinary lists together", () => {
  show();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "unknown" });
  expect(fixture.registry.get(shownHqListNavigationAtom).structure).toBeNull();
  seed();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toMatchObject({
    kind: "present",
    projectId: "chief",
  });
  expect(
    fixture.registry.get(shownHqListNavigationAtom).structure?.apps.map((app) => app.id),
  ).toEqual(["work"]);
});

it("An explicitly deleted Chief leaves the header without entering the Mate list", () => {
  seed();
  show();
  const scope = placementsScope(ORG);
  fixture.store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: fixture.store.state().streams.get(scope)?.generation ?? 0 }],
    reset: false,
    rows: [],
    removals: [{ family: "placement", id: "chief", reason: "deleted" }],
  });
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "absent" });
  expect(Object.keys(fixture.registry.get(shownHqListedMateIdentitiesAtom))).toEqual(["ordinary"]);
});

it("Switching organizations never carries the previous organization's personal Chief", () => {
  seed();
  show();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toMatchObject({
    kind: "present",
    projectId: "chief",
  });
  show("other-org");
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "unknown" });
  expect(fixture.registry.get(shownHqListNavigationAtom).structure).toBeNull();
  seedHqNavigation(fixture.store, "other-org", { structure: { apps: [], ungrouped: [] } });
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "absent" });
  show();
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toMatchObject({
    kind: "present",
    projectId: "chief",
  });
  show(null);
  expect(fixture.registry.get(shownHqMateDirectoryAtom).myChief).toEqual({ kind: "unknown" });
});

it("A Chief's kept connection stays out of search before HQ sends its environment identity", () => {
  show();
  liveProjects(ORG, [{ id: "chief", tagList: ["chief"] }]).forEach(fixture.store.dispatch);
  fixture.store.dispatch({
    kind: "rows",
    scope: mateLinkScope("chief"),
    generation: 0,
    method: "read",
    via: "mate-direct",
    rows: [
      {
        family: "mateLink",
        id: "chief:zcp",
        revision: { kind: "mate-link", sequence: 1 },
        value: {
          key: "chief:zcp",
          projectId: "chief",
          orgId: ORG,
          origin: null,
          shown: true,
          watched: false,
          environment: initialEnvironment({ record: EnvironmentId.make("kept-chief-env") }),
          container: initialContainer(),
        },
      },
    ],
  });
  expect(fixture.registry.get(shownHqMateDirectoryAtom).chiefEnvironmentIds).toEqual([
    "kept-chief-env",
  ]);
  expect(
    isListedMateEnvironment(
      fixture.registry.get(shownHqMateDirectoryAtom),
      EnvironmentId.make("kept-chief-env"),
    ),
  ).toBe(false);
});
