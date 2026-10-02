import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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
        assert.strictEqual((yield* Effect.flip(roles.view))._tag, "ZeropsUnavailable");
        world.down = false;
        assert.deepStrictEqual(userIds(yield* roles.view), ["owner"]);

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
        yield* TestClock.adjust("30 seconds");
        assert.strictEqual((yield* Effect.flip(roles.view))._tag, "ZeropsUnavailable");
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
