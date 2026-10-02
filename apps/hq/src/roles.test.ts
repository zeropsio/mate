import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { type OrgView, Roles, canWriteStructure, effectiveRole, rolesLayer } from "./roles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsProject } from "./zerops/api.ts";

const member = (userId: string, roleCode: string, status = "ACTIVE"): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status,
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
});

const VIEW: OrgView = {
  orgId: "ORG",
  members: [
    member("owner", "OWNER"),
    member("admin", "ADMIN"),
    member("dev", "NO_ACCESS"),
    member("reader", "READ_ONLY"),
    member("invited", "ADMIN", "INVITED"),
    member("future", "SUPER_ADMIN"),
  ],
  projects: [
    project("P1", [
      { clientUserId: "C-dev", roleCode: "BASIC_USER" },
      { clientUserId: "C-owner", roleCode: "NO_ACCESS" },
    ]),
    project("P2"),
    project("P3", [{ clientUserId: "C-dev", roleCode: "SOMETHING_NEW" }]),
  ],
};

describe("effectiveRole", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["owner", "P2", "OWNER"],
    ["owner", "P1", "NO_ACCESS"], // an override lowers even an owner
    ["dev", "P1", "BASIC_USER"],
    ["dev", "P2", "NO_ACCESS"],
    ["reader", "P2", "READ_ONLY"],
    ["invited", "P2", "NO_ACCESS"], // not active: no rights
    ["stranger", "P2", "NO_ACCESS"],
    ["owner", "P9", "NO_ACCESS"], // no such project
    // A role this build does not know is no role (main's `asOrgRole`): never visible.
    ["dev", "P3", "NO_ACCESS"],
    ["future", "P2", "NO_ACCESS"],
  ];
  for (const [userId, projectId, role] of cases) {
    it(`${userId} on ${projectId}: ${role}`, () => {
      assert.strictEqual(effectiveRole(VIEW, userId, projectId), role);
    });
  }
});

describe("canWriteStructure", () => {
  it("is an active org owner or admin, nobody else", () => {
    assert.deepStrictEqual(
      ["owner", "admin", "dev", "reader", "invited", "stranger"].map((userId) =>
        canWriteStructure(VIEW, userId),
      ),
      [true, true, false, false, false, false],
    );
  });
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
