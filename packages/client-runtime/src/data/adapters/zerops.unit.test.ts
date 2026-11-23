import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import { detailScopeOf } from "../demand.ts";
import { projectsScope } from "../families/project.ts";
import { activeScope } from "../families/version.ts";
import { linkKeys } from "../model.ts";
import { platformMembership } from "../projections/platformCapabilities.ts";
import { platformInventory } from "../projections/platformInventory.ts";
import { factOf } from "../reducer.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { ZeropsApiError } from "../../zerops/errors.ts";
import { zeropsNavigationLink } from "./zerops.ts";
import { makeZeropsWire, type ZeropsWireClient } from "./zeropsWire.ts";

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
  "AD68: A project denied to the viewer comes back only from a later baseline that lists it, never from a push",
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
  "AD69: A baseline cut at the page limit is not complete: no member it did not reach is taken as gone",
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
  "AD70: A membership frame for the signed-in person reads their role and projects again, so after a demotion to No access their role reads No access and their projects none once that read answers",
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
      const standing = () => {
        const read = readsOfState(store.state());
        return {
          role: platformMembership.derive(read, ORG).viewer?.roleCode,
          projects: read.members(projectsScope(ORG)).ids,
        };
      };
      expect(standing()).toEqual({ role: "READ_ONLY", projects: ["v2"] });

      now.roleCode = "NO_ACCESS";
      now.projects = [];
      yield* fixture.push(fixture.subscription(CLIENT_USER_SEARCH, "updateStream"), {
        update: [
          { id: "v8", clientId: ORG, userId: "v4", roleCode: "NO_ACCESS", status: "ACTIVE" },
        ],
      });
      yield* settle;
      expect(standing()).toEqual({ role: "NO_ACCESS", projects: [] });
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | followChanges(ownLeft, held, new Set(["organizationUser"])) → followChanges(ownLeft, held)
it.effect(
  "AD74: The person's own membership leaving the organization reads their membership alone, never the projects or the member list, so their access moves to none",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const own = {
        id: "v7",
        clientId: ORG,
        userId: "v4",
        roleCode: "BASIC_USER",
        status: "ACTIVE",
      };
      const now = { memberships: [own] as ReadonlyArray<typeof own> };
      const fixture = fixtureWire(
        platform(
          (path) => ({ items: path === CLIENT_USER_SEARCH ? now.memberships : [] }),
          (path) =>
            path === "/user/info"
              ? {
                  status: 200,
                  body: {
                    id: "v4",
                    email: "v5@v6.test",
                    clientUserList: now.memberships.map(({ id, clientId, status, roleCode }) => ({
                      id,
                      clientId,
                      status,
                      roleCode,
                      canCreateProjects: false,
                    })),
                  },
                }
              : { status: 403, body: null },
        ),
      );
      const { fiber, link } = yield* running(store, fixture);
      link.demandDetail({ family: "organizationUser", ownerId: ORG });
      yield* settle;
      const membership = () => platformMembership.derive(readsOfState(store.state()), ORG);
      expect(membership()).toMatchObject({ kind: "known", viewer: { roleCode: "BASIC_USER" } });

      // Zerops lets the membership go by its id alone: the row says nothing of whose it was.
      now.memberships = [];
      const before = fixture.requests.length;
      yield* fixture.push(fixture.subscription(CLIENT_USER_SEARCH, "listStream"), {
        add: [],
        delete: ["v7"],
      });
      yield* settle;
      expect(membership()).toEqual({ kind: "known", viewer: undefined });
      expect(fixture.requests.slice(before).map(({ path }) => path)).toEqual(["/user/info"]);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | Effect.tapError(() => → Effect.tapError((fault) => fault !== ACCESS_CHANGED ? Effect.void :
it.effect(
  "AD78: A membership its pushes keep fresh is read again under the next registration after the Zerops socket was lost, never on a cadence",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const project = (id: string) => ({
        id,
        name: id,
        status: "ACTIVE",
        clientId: ORG,
        _version: 1,
      });
      const fixture = fixtureWire(
        platform(
          (path) => ({ items: path === PROJECT_SEARCH ? ["v2"].map(project) : [] }),
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
                        roleCode: "BASIC_USER",
                        canCreateProjects: false,
                      },
                    ],
                  },
                }
              : { status: 403, body: null },
        ),
      );
      const { fiber, link } = yield* running(store, fixture);
      link.demandDetail({ family: "organizationUser", ownerId: ORG });
      yield* settle;
      const userInfoReads = () =>
        fixture.requests.filter(({ path }) => path === "/user/info").length;
      expect(userInfoReads()).toBe(1);

      // At rest nothing reads the membership again.
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(userInfoReads()).toBe(1);

      // The socket was lost: Zerops replays nothing, so the next registration reads it once.
      yield* reopened(store, fixture);
      expect(fixture.opens()).toBe(2);
      expect(userInfoReads()).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | Effect.tapError(() => → Effect.tapError((fault) => fault === ACCESS_CHANGED ? Effect.void :
it.effect(
  "AD79: An attempt the adapter ends on a refusal of access has the person's membership read again by the next attempt, and no reading of their access is taken until it answers; breaks: the org role stays Basic user while Zerops says No access, so New project and the other role offers stay wrong, or one change is told to HQ twice",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const project = { id: "v2", name: "v3", status: "ACTIVE", clientId: ORG, _version: 1 };
      const now = { roleCode: "BASIC_USER" };
      const fixture = fixtureWire(
        platform(
          (path) => ({ items: path === PROJECT_SEARCH ? [project] : [] }),
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
              : { status: 403, body: null },
        ),
      );
      const { fiber, link } = yield* running(store, fixture);
      link.demandDetail({ family: "organizationUser", ownerId: ORG });
      yield* settle;
      const membership = () => platformMembership.derive(readsOfState(store.state()), ORG);
      const reading = () =>
        readsOfState(store.state()).members(
          detailScopeOf(ORG, { family: "organizationUser", ownerId: ORG }),
        ).reading;
      expect(membership()).toMatchObject({ kind: "known", viewer: { roleCode: "BASIC_USER" } });

      // The person is demoted, and the project's delete comes before any frame of their own row:
      // its owner refuses it, which ends the attempt.
      now.roleCode = "NO_ACCESS";
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
        add: [],
        delete: ["v2"],
      });
      yield* settle;
      expect(reading()).toBe(true);

      // The next attempt reads the membership again.
      const next = store.state().streams.get(linkKeys.zerops(ORG))?.next;
      yield* TestClock.adjust(next?.kind === "retry" ? next.at : 0);
      yield* settle;
      expect(membership()).toMatchObject({ kind: "known", viewer: { roleCode: "NO_ACCESS" } });
      expect(reading()).toBe(false);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | if (!(yield* verifyAbsence(scope, id))) continue; → if (!(yield* verifyAbsence(scope, id)) || index < ids.length - 1) continue;
it.effect(
  "AD76: Members gone from a scope are verified by id until the first refusal of access; the rest are withheld without a read and the attempt ends once",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const project = (id: string) => ({
        id,
        name: id,
        status: "ACTIVE",
        clientId: ORG,
        _version: 1,
      });
      const fixture = fixtureWire(
        platform((path) => ({
          items: path === PROJECT_SEARCH ? ["v2", "v3", "v4"].map(project) : [],
        })),
      );
      const { fiber } = yield* running(store, fixture);
      const before = fixture.requests.length;

      // The person loses the three projects at once: Zerops lists them gone, and refuses each.
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
        add: [],
        delete: ["v2", "v3", "v4"],
      });
      yield* settle;
      const reads = fixture.requests.slice(before).filter(({ method }) => method === "GET");
      expect(reads.map(({ path }) => path)).toEqual(["/project/v2"]);
      const facts = readsOfState(store.state());
      for (const id of ["v2", "v3", "v4"])
        expect(facts.fact("project", id), id).toMatchObject({ kind: "withheld", reason: "denied" });
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | "kept", → "ends",
it.effect(
  "AD77: A refusal of access found verifying the absences of an attempt's own registration baselines does not end that attempt",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let projects: ReadonlyArray<unknown> = [
        { id: "v2", name: "v3", status: "ACTIVE", clientId: ORG, _version: 1 },
      ];
      const fixture = fixtureWire(
        platform((path) => ({ items: path === PROJECT_SEARCH ? projects : [] })),
      );
      const { fiber } = yield* running(store, fixture);

      // The next attempt's registration lists the project no more, and its owner refuses it.
      projects = [];
      yield* reopened(store, fixture);
      expect(readsOfState(store.state()).fact("project", "v2")).toMatchObject({
        kind: "withheld",
        reason: "denied",
      });
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      expect(fixture.opens()).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | const asked = ids.filter((id) => !resolving.has(keyOf(id))); → const asked = ids.filter((id) => resolving.has(keyOf(id)));
it.effect(
  "AD82: A member listed again while its row is still being read is not read a second time; once that read answered, the row is held; breaks: every repeated listing of a new process or project sends the same search again at once",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const processRow = {
        id: "v-p1",
        projectId: "v2",
        status: "RUNNING",
        actionName: "v3",
        created: "2026-01-01T00:00:00Z",
        _version: 1,
      };
      const byId = (request: WireRequest) =>
        request.path === "/process/search" &&
        Array.isArray(request.body?.search) &&
        request.body.search.some(
          (filter: unknown) =>
            typeof filter === "object" &&
            filter !== null &&
            "name" in filter &&
            filter.name === "id" &&
            "operator" in filter &&
            filter.operator === "in",
        );
      const answered = yield* Deferred.make<unknown>();
      const listed = platform(() => ({ items: [] }));
      const fixture = fixtureWire((request) =>
        byId(request) ? Deferred.await(answered) : listed(request),
      );
      const { fiber } = yield* running(store, fixture);

      // Zerops lists the new process twice before the read of its row answers.
      const listing = fixture.subscription("/process/search", "listStream");
      yield* fixture.push(listing, { add: ["v-p1"] });
      yield* fixture.push(listing, { add: ["v-p1"] });
      yield* settle;
      const reads = fixture.requests.filter(byId);
      expect(reads.map(({ body }) => body?.search)).toEqual([
        expect.arrayContaining([{ name: "id", operator: "in", value: ["v-p1"] }]),
      ]);

      yield* Deferred.succeed(answered, { items: [processRow] });
      yield* settle;
      expect(factOf(store.state(), "process", "v-p1")?.content).toEqual({
        kind: "value",
        value: {
          id: "v-p1",
          projectId: "v2",
          serviceStackIds: [],
          status: "RUNNING",
          actionName: "v3",
          created: "2026-01-01T00:00:00Z",
        },
      });
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/families/clientUser.ts | held.roleCode === value.roleCode && → held.roleCode !== value.roleCode &&
it.effect(
  "AD83: The person's membership read before Zerops answered the registration of the organization's memberships (the session's own `/user/info`) is read again once that registration lists it with another role, whichever of the two lands first, so a demotion landing between them reads No access although its frame never comes; breaks: a person demoted while the page loads keeps their old role, and HQ keeps showing them the Mates it showed before",
  () =>
    Effect.gen(function* () {
      const userInfo = (roleCode: string) => ({
        id: "v4",
        email: "v5@v6.test",
        clientUserList: [
          { id: "v7", clientId: ORG, status: "ACTIVE", roleCode, canCreateProjects: false },
        ],
      });
      const listed = {
        items: [{ id: "v7", clientId: ORG, userId: "v4", roleCode: "NO_ACCESS", status: "ACTIVE" }],
      };
      for (const order of [
        "the listing after the session's answer",
        "the session's answer after the listing",
      ]) {
        const store = makeAccountStore(AtomRegistry.make());
        // The session verified itself on `/user/info` as a Basic user; then the Owner demoted them,
        // before the memberships' registration, so Zerops answers No access and sends no frame.
        const listing = yield* Deferred.make<void>();
        const fixture = fixtureWire(
          (request) =>
            request.path === CLIENT_USER_SEARCH && request.body?.wsOutputType === "listStream"
              ? Effect.as(Deferred.await(listing), listed)
              : platform(
                  () => ({ items: [] }),
                  (path) =>
                    path === "/user/info"
                      ? { status: 200, body: userInfo("NO_ACCESS") }
                      : path.startsWith(`/client/${ORG}/user/list`)
                        ? { status: 200, body: { clientUserList: [{ id: "v7" }] } }
                        : { status: 403, body: null },
                )(request),
          {
            held: (path) =>
              path === "/user/info" ? { body: userInfo("BASIC_USER"), atMs: 0 } : undefined,
          },
        );
        const { fiber, link } = yield* running(store, fixture);
        const demand = () => link.demandDetail({ family: "organizationUser", ownerId: ORG });
        const role = () =>
          platformMembership.derive(readsOfState(store.state()), ORG).viewer?.roleCode;
        if (order === "the listing after the session's answer") {
          demand();
          yield* settle;
          expect(role(), order).toBe("BASIC_USER");
          yield* Deferred.succeed(listing, undefined);
        } else {
          yield* Deferred.succeed(listing, undefined);
          yield* settle;
          demand();
        }
        yield* settle;
        expect(role(), order).toBe("NO_ACCESS");
        yield* Fiber.interrupt(fiber);
      }
    }),
);

// witness: packages/client-runtime/src/data/adapters/zerops.ts | observed.set(scope, generationOf(scope)); → observed.set(scope, streamOf(store.state(), scope).generation);
it.effect(
  "AD84: A detail asked to be read again as its read answers, before that read has ended, is read again at once; breaks: the ask starts no read, so the detail stands unanswered until its deadline passes ten seconds later and shows a failed read before its retry reads it",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const now = { roleCode: "BASIC_USER" };
      const fixture = fixtureWire(
        platform(
          () => ({ items: [] }),
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
              : { status: 403, body: null },
        ),
      );
      const { fiber, link } = yield* running(store, fixture);
      const demand = { family: "organizationUser", ownerId: ORG } as const;
      const scope = detailScopeOf(ORG, demand);
      // The publication that turns the detail live runs before its read's fiber ends: the ask lands there.
      const stop = store.subscribe(() => {
        if (store.state().streams.get(scope)?.phase !== "live") return;
        stop();
        now.roleCode = "NO_ACCESS";
        link.revalidate(demand);
      });
      link.demandDetail(demand);
      yield* settle;
      expect(platformMembership.derive(readsOfState(store.state()), ORG).viewer?.roleCode).toBe(
        "NO_ACCESS",
      );
      expect(fixture.requests.filter(({ path }) => path === "/user/info").length).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/zeropsWire.ts | [/^\/process\/[^/?]+$/u, "processNotFound"], → [/^\/process\/[^/?]+$/u, "processGone"],
it.effect(
  "AD+1: A process Zerops answers processNotFound for is read once for as long as the page stands, through a retry, a re-read of the listing and a new hold; breaks: every retry asks Zerops again for a process that no longer exists",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      // The session's own client as Zerops answers a gone process (measured: 404 processNotFound).
      const client = {
        requestData: () =>
          Promise.reject(new ZeropsApiError("v3", "not-found", 404, "processNotFound")),
      } as unknown as ZeropsWireClient;
      const session = makeZeropsWire({ client });
      const fixture = fixtureWire((request) =>
        request.method === "GET" && request.path === "/process/v2"
          ? session.read!(request.path)
          : platform(() => ({ items: [] }))(request),
      );
      const { fiber, link } = yield* running(store, fixture);
      const demand = { family: "process", listing: "process", ownerId: "v2" } as const;
      const asks = () => fixture.requests.filter(({ path }) => path === "/process/v2").length;
      const release = link.demandDetail(demand);
      yield* settle;
      expect(asks()).toBe(1);
      link.retryDetail(demand);
      yield* settle;
      expect(asks()).toBe(1);
      link.reread();
      yield* settle;
      yield* reopened(store, fixture);
      expect(asks()).toBe(1);
      release();
      yield* settle;
      link.demandDetail(demand);
      yield* settle;
      expect(asks()).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
);
