import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { type OrgView, Roles, rolesLayer } from "./roles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsProject } from "./zerops/api.ts";

const member = (userId: string, roleCode: string): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
});

const project = (id: string, userRoles: ZeropsProject["userRoles"] = []): ZeropsProject => ({
  id,
  orgId: "ORG",
  name: id,
  status: "ACTIVE",
  tags: [],
  userRoles,
  publicZone: `${id}.prg1-zerops.zone`,
});

describe("rolesLayer", () => {
  it.effect(
    "serves the org view for 30 s, reads it fresh on demand, and never caches a failure",
    () =>
      Effect.gen(function* () {
        const world = emptyWorld();
        world.tokens.set("t", {
          id: "T",
          name: "mate-hq-org:HQ",
          orgId: "ORG",
          roleCode: "READ_ONLY",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: [],
          createdMs: 0,
          createdByUser: "owner",
        });
        world.members.set("ORG", [member("owner", "OWNER")]);
        world.projects.push(project("HQ"));
        const context = yield* Layer.build(
          rolesLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("t")) }).pipe(
            Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
          ),
        );
        const roles = Context.get(context, Roles);
        const userIds = (view: OrgView) => view.members.map((row) => row.userId);

        assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);
        // What a write may be decided over says so: read now, or served from the cache.
        assert.strictEqual((yield* roles.view).freshness, "cached");
        assert.strictEqual((yield* roles.fresh).freshness, "fresh");
        world.members.get("ORG")!.push(member("admin", "ADMIN"));
        yield* TestClock.adjust("29 seconds");
        assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);
        assert.deepStrictEqual(userIds(yield* roles.fresh), ["owner", "admin"]);
        world.members.get("ORG")!.pop();
        yield* TestClock.adjust("30 seconds");
        assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);

        world.down = true;
        yield* TestClock.adjust("30 seconds");
        assert.strictEqual((yield* Effect.flip(roles.fresh))._tag, "ZeropsUnavailable");
        world.down = false;
        yield* TestClock.adjust("1 millis");
        assert.deepStrictEqual(userIds(yield* roles.fresh), ["owner"]);

        // Concurrent readers share one read: of the view past its age, and of a fresh one.
        yield* TestClock.adjust("30 seconds");
        const before = world.calls.filter((call) => call.startsWith("members:")).length;
        yield* Effect.all(
          Array.from({ length: 5 }, () => roles.view),
          { concurrency: "unbounded" },
        );
        yield* TestClock.adjust("1 millis");
        yield* Effect.all(
          Array.from({ length: 5 }, () => roles.fresh),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(
          world.calls.filter((call) => call.startsWith("members:")).length - before,
          2,
        );

        // An empty member list is an outage dressed as an answer (an org always has its owner).
        world.members.set("ORG", []);
        yield* TestClock.adjust("1 millis");
        assert.strictEqual((yield* Effect.flip(roles.fresh))._tag, "ZeropsUnavailable");
        // Past the five minutes the last good view is served while Zerops does not answer.
        yield* TestClock.adjust("5 minutes");
        assert.strictEqual((yield* Effect.flip(roles.view))._tag, "ZeropsUnavailable");
      }),
  );
});

// E2E 2026-10-03: a4's recipe answered 503 `zerops_unavailable` right after its birth, and B's
// read late for a minute — KRLS's member list not answering inside HQ's 10 s. A read verb decides
// over the last good view for five minutes while Zerops does not answer; a write never does.
describe("the last good view, while Zerops does not answer", () => {
  const layer = (world: ReturnType<typeof emptyWorld>) =>
    Layer.build(
      rolesLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("t")) }).pipe(
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
      ),
    );
  const world = () => {
    const made = emptyWorld();
    made.tokens.set("t", {
      id: "T",
      name: "mate-hq-org:HQ",
      orgId: "ORG",
      roleCode: "READ_ONLY",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [],
      createdMs: 0,
      createdByUser: "owner",
    });
    made.members.set("ORG", [member("owner", "OWNER")]);
    made.projects.push(project("HQ"));
    return made;
  };
  const userIds = (view: OrgView) => view.members.map((row) => row.userId);
  /** The member list failing as KRLS's did: an outage dressed as an empty answer. */
  const membersFail = (made: ReturnType<typeof emptyWorld>) => made.members.set("ORG", []);

  it.effect("answers a read verb with it inside the window, a write never, past it neither", () =>
    Effect.gen(function* () {
      const made = world();
      const roles = Context.get(yield* layer(made), Roles);
      assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);

      membersFail(made);
      yield* TestClock.adjust("31 seconds");
      const served = yield* roles.view;
      assert.deepStrictEqual(userIds(served), ["owner"]);
      assert.strictEqual(served.freshness, "cached");
      assert.strictEqual((yield* Effect.flip(roles.fresh))._tag, "ZeropsUnavailable");

      // Five minutes after the last good read, nothing is decided over it.
      yield* TestClock.adjust("269 seconds");
      assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);
      yield* TestClock.adjust("1 millis");
      assert.strictEqual((yield* Effect.flip(roles.view))._tag, "ZeropsUnavailable");
    }),
  );

  it.effect("answers at once in an outage, and asks Zerops again at most every 30 s", () =>
    Effect.gen(function* () {
      const made = world();
      const roles = Context.get(yield* layer(made), Roles);
      yield* roles.view;
      membersFail(made);
      yield* TestClock.adjust("31 seconds");
      yield* roles.view;
      const asked = () => made.calls.filter((call) => call.startsWith("members:")).length;
      const before = asked();

      // Nobody waits on a Zerops that just failed: each read is the last good view, at once.
      yield* Effect.all(
        Array.from({ length: 5 }, () => roles.view),
        { concurrency: "unbounded" },
      );
      yield* TestClock.adjust("29 seconds");
      yield* roles.view;
      assert.strictEqual(asked() - before, 0);

      // Thirty seconds on, the view is still served at once, and Zerops is asked behind it.
      made.members.set("ORG", [member("owner", "OWNER"), member("admin", "ADMIN")]);
      yield* TestClock.adjust("1 seconds");
      assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);
      yield* TestClock.adjust("1 millis");
      assert.strictEqual(asked() - before, 1);
      assert.deepStrictEqual(userIds(yield* roles.view), ["owner", "admin"]);
    }),
  );
});

// A door that gave up on a slow read at its budget (`door.ts`) is asked again after its
// Retry-After: the read it left lands for it, aged from when Zerops answered — never from when it
// was asked, which would make a read slower than 30 s stale the moment it lands, and every door
// asked again read once more. A write still takes only a read begun after it asked.
describe("a slow read, aged from its answer", () => {
  const made = () => {
    const world = emptyWorld();
    world.tokens.set("t", {
      id: "T",
      name: "mate-hq-org:HQ",
      orgId: "ORG",
      roleCode: "READ_ONLY",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [],
      createdMs: 0,
      createdByUser: "owner",
    });
    world.members.set("ORG", [member("owner", "OWNER")]);
    world.projects.push(project("HQ"));
    return world;
  };
  /** Roles over `world`, its member list answering after 40 s. */
  const slowRoles = (world: ReturnType<typeof emptyWorld>) =>
    Effect.map(
      Layer.build(
        rolesLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("t")) }).pipe(
          Layer.provide(
            Layer.succeed(ZeropsApi, {
              ...fakeZeropsApi(world),
              members: (orgId) => (credential) =>
                Effect.delay(fakeZeropsApi(world).members(orgId)(credential), "40 seconds"),
            }),
          ),
        ),
      ),
      (context) => Context.get(context, Roles),
    );
  const membersRead = (world: ReturnType<typeof emptyWorld>) =>
    world.calls.filter((call) => call.startsWith("members:")).length;

  it.effect("serves a read that took 40 s as recent once it answered, a write never", () =>
    Effect.gen(function* () {
      const world = made();
      const roles = yield* slowRoles(world);
      const reading = yield* Effect.forkChild(roles.recent);
      yield* TestClock.adjust("40 seconds");
      yield* Fiber.join(reading);
      const before = membersRead(world);

      yield* TestClock.adjust("1 seconds");
      assert.deepStrictEqual(
        (yield* roles.recent).members.map((row) => row.userId),
        ["owner"],
      );
      assert.strictEqual(membersRead(world) - before, 0);

      const writing = yield* Effect.forkChild(roles.fresh);
      yield* TestClock.adjust("40 seconds");
      yield* Fiber.join(writing);
      assert.strictEqual(membersRead(world) - before, 1);
    }),
  );
});

describe("Roles.exists", () => {
  it.effect(
    "asks Zerops for a project by id: gone when refused not found, unknown when unreachable",
    () =>
      Effect.gen(function* () {
        const world = emptyWorld();
        world.tokens.set("t", {
          id: "T",
          name: "mate-hq-org:HQ",
          orgId: "ORG",
          roleCode: "READ_ONLY",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: [],
          createdMs: 0,
          createdByUser: "owner",
        });
        world.projects.push(project("HQ"), project("P1"));
        const context = yield* Layer.build(
          rolesLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("t")) }).pipe(
            Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
          ),
        );
        const roles = Context.get(context, Roles);
        assert.deepStrictEqual(yield* Effect.all([roles.exists("P1"), roles.exists("P_GONE")]), [
          true,
          false,
        ]);
        world.down = true;
        assert.strictEqual((yield* Effect.flip(roles.exists("P1")))._tag, "ZeropsUnavailable");
      }),
  );
});
