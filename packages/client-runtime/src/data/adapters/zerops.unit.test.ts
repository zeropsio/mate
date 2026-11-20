import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import { activeScope } from "../families/version.ts";
import { linkKeys } from "../model.ts";
import { mateVisibility } from "../projections/mateVisibility.ts";
import { platformInventory } from "../projections/platformInventory.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { zeropsNavigationLink } from "./zerops.ts";

const ORG = "v1";
const PROJECT_SEARCH = "/project/search";
const VERSION_SEARCH = "/app-version/search";
const CLIENT_USER_SEARCH = "/client-user/search";

type Answer = (request: WireRequest) => Effect.Effect<unknown, StreamFault>;

/** Zerops as the organization's link meets it: every registration accepted, every list as `listed` says. */
const platform =
  (
    listed: (path: string) => {
      readonly items: ReadonlyArray<unknown>;
      readonly totalHits?: number;
    },
    get: (path: string) => { readonly status: number; readonly body: unknown } = () => ({
      status: 403,
      body: null,
    }),
  ): Answer =>
  (request) =>
    request.method === "GET"
      ? Effect.succeed(get(request.path))
      : request.body?.wsOutputType === "updateStream"
        ? Effect.succeed({ success: true })
        : Effect.succeed(listed(request.path));

/** The organization's link running under its supervisor. */
const running = (store: AccountStore, fixture: ReturnType<typeof fixtureWire>) =>
  Effect.gen(function* () {
    let subscription = 0;
    const link = zeropsNavigationLink({
      orgId: ORG,
      wire: fixture.wire,
      store,
      makeId: () => `v-subscription-${(subscription += 1)}`,
    });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { fiber, link };
  });

/** The link's socket breaks, and its next attempt opens once its retry is due. */
const reopened = (store: AccountStore, fixture: ReturnType<typeof fixtureWire>) =>
  Effect.gen(function* () {
    yield* fixture.drop({ outcome: "transient", message: "v-socket-closed" });
    yield* settle;
    const next = store.state().streams.get(linkKeys.zerops(ORG))?.next;
    yield* TestClock.adjust(next?.kind === "retry" ? next.at : 0);
    yield* settle;
  });

// witness: packages/client-runtime/src/data/reducer.ts | if (current.content.kind === "purged" && input.method === "push") return false; → if (current.content.kind === "purged" && input.method === "never") return false;
it.effect(
  "AD+8: A project denied to the viewer comes back only from a later baseline that lists it, never from a push",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const project = { id: "v2", name: "v3", status: "ACTIVE", clientId: ORG, _version: 1 };
      let projects: ReadonlyArray<unknown> = [project];
      const fixture = fixtureWire(
        platform((path) => ({ items: path === PROJECT_SEARCH ? projects : [] })),
      );
      const { fiber } = yield* running(store, fixture);
      const inventory = () =>
        platformInventory.derive(readsOfState(store.state()), {
          orgId: ORG,
          viewer: { id: ORG, name: "v4", membershipId: "v5", roleCode: "ADMIN" },
        });
      expect(inventory().projects.map(({ id }) => id)).toEqual(["v2"]);

      // The project leaves the viewer's list and its owner refuses it: denied.
      projects = [];
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
        add: [],
        delete: ["v2"],
      });
      yield* settle;
      yield* reopened(store, fixture);
      expect(inventory().denied).toEqual(["v2"]);

      // A push of its row on the live socket says nothing of access returning.
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "updateStream"), {
        update: [{ ...project, name: "v6", _version: 2 }],
      });
      yield* settle;
      expect(inventory().denied).toEqual(["v2"]);
      expect(inventory().projects).toEqual([]);

      // A baseline listing it again does.
      projects = [{ ...project, name: "v6", _version: 2 }];
      yield* reopened(store, fixture);
      expect(inventory().denied).toEqual([]);
      expect(inventory().projects.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: "v2", name: "v6" },
      ]);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | (totalHits !== undefined && totalHits > items.length) → (totalHits !== undefined && totalHits < items.length)
it.effect(
  "AD+9: A baseline cut at the page limit is not complete: no member it did not reach is taken as gone",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const version = (id: string) => ({
        id,
        projectId: "v2",
        serviceStackId: "v3",
        status: "ACTIVE",
        source: "GIT",
        _version: 1,
      });
      let versions: { readonly items: ReadonlyArray<unknown>; readonly totalHits?: number } = {
        items: [version("v4"), version("v5")],
      };
      const fixture = fixtureWire(
        platform((path) => (path === VERSION_SEARCH ? versions : { items: [] })),
      );
      const { fiber } = yield* running(store, fixture);
      const active = () => readsOfState(store.state()).members(activeScope(ORG));
      expect(active().ids.toSorted()).toEqual(["v4", "v5"]);

      // The next baseline reaches its page limit before v5.
      versions = { items: [version("v4")], totalHits: 2 };
      yield* reopened(store, fixture);
      expect(active().coverage).not.toBe("complete");
      expect(active().ids.toSorted()).toEqual(["v4", "v5"]);
      expect(readsOfState(store.state()).fact("version", "v5").kind).toBe("known");
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/families/clientUser.ts | return viewer.kind === "known" && viewer.value.id === row.value.userId; → return viewer.kind === "known" && viewer.value.id !== row.value.userId;
it.effect(
  "AD+10: A membership frame for the signed-in person reads their role and projects again, so a demotion to No access hides the organization's Mates once that read answers none",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = {
        id: "v2",
        name: "v3",
        status: "ACTIVE",
        clientId: ORG,
        userRoles: [],
        _version: 1,
      };
      const now = { roleCode: "READ_ONLY", projects: [mate] as ReadonlyArray<unknown> };
      const fixture = fixtureWire(
        platform(
          (path) => ({ items: path === PROJECT_SEARCH ? now.projects : [] }),
          (path) =>
            path === "/user/info"
              ? {
                  status: 200,
                  body: {
                    id: "v4",
                    email: "v5@v6.test",
                    clientUserList: [
                      {
                        id: "v7",
                        clientId: ORG,
                        status: "ACTIVE",
                        roleCode: now.roleCode,
                        canCreateProjects: false,
                      },
                    ],
                  },
                }
              : path.startsWith(`/client/${ORG}/user/list`)
                ? { status: 200, body: { clientUserList: [{ id: "v7" }] } }
                : { status: 403, body: null },
        ),
      );
      const { fiber, link } = yield* running(store, fixture);
      link.demandDetail({ family: "organizationUser", ownerId: ORG });
      yield* settle;
      const visibility = () =>
        mateVisibility.derive(readsOfState(store.state()), { orgId: ORG, projectId: "v2" });
      expect(visibility()).toBe("listed");

      now.roleCode = "NO_ACCESS";
      now.projects = [];
      yield* fixture.push(fixture.subscription(CLIENT_USER_SEARCH, "updateStream"), {
        update: [
          { id: "v8", clientId: ORG, userId: "v4", roleCode: "NO_ACCESS", status: "ACTIVE" },
        ],
      });
      yield* settle;
      expect(visibility()).toBe("hidden");
      yield* Fiber.interrupt(fiber);
    }),
);
