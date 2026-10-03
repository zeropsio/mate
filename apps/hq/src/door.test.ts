import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { Door, doorLayer } from "./door.ts";
import { Roles, rolesLayer } from "./roles.ts";
import { ZeropsApi, type ZeropsMember } from "./zerops/api.ts";

const HQ = "HQ";

const owner: ZeropsMember = {
  name: "owner",
  kind: "person",
  roleCode: "OWNER",
  status: "ACTIVE",
  userId: "owner",
  clientUserId: "C-owner",
  canCreateProjects: false,
};

const world = () => {
  const made = emptyWorld();
  made.tokens.set("t", {
    id: "T",
    name: `mate-hq-org:${HQ}`,
    orgId: "ORG",
    roleCode: "READ_ONLY",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: "owner",
  });
  made.members.set("ORG", [owner]);
  made.projects.push({
    id: HQ,
    orgId: "ORG",
    name: HQ,
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: "hq.prg1-zerops.zone",
  });
  return made;
};

/** The owner's throwaway for HQ's door, minted now. */
const throwaway = (made: ReturnType<typeof emptyWorld>, value: string) =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    made.tokens.set(value, {
      id: value,
      name: `mate-door:${HQ}:n0nce`,
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [],
      createdMs: now,
      createdByUser: "owner",
    });
    return Redacted.make(value);
  });

const services = (made: ReturnType<typeof emptyWorld>) =>
  Effect.gen(function* () {
    const roles = rolesLayer({ hqProjectId: HQ, credential: Option.some(Redacted.make("t")) });
    const context = yield* Layer.build(
      Layer.provideMerge(doorLayer({ hqProjectId: HQ }), roles).pipe(
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(made))),
      ),
    );
    return { door: Context.get(context, Door), roles: Context.get(context, Roles) };
  });

const membersRead = (made: ReturnType<typeof emptyWorld>) =>
  made.calls.filter((call) => call.startsWith("members:")).length;

// t11, 2026-10-03: two of fourteen cold loads hung 55 s and 77 s at HQ's door, each door re-entered
// queuing behind a fresh read of KRLS's slow member list. The door admits by a view at most 30 s
// old, as a read verb does — never by the last good view a read verb falls back to.
describe("HQ's door, over the org's view", () => {
  it.effect("admits over a view read under 30 s ago, asking Zerops nothing", () =>
    Effect.gen(function* () {
      const made = world();
      const { door } = yield* services(made);
      assert.strictEqual((yield* door.admit(yield* throwaway(made, "door-1"))).userId, "owner");
      const before = membersRead(made);

      yield* TestClock.adjust("29 seconds");
      assert.strictEqual((yield* door.admit(yield* throwaway(made, "door-2"))).userId, "owner");
      assert.strictEqual(membersRead(made) - before, 0);
    }),
  );

  it.effect("reads the org again for a door past 30 s", () =>
    Effect.gen(function* () {
      const made = world();
      const { door } = yield* services(made);
      yield* door.admit(yield* throwaway(made, "door-1"));
      const before = membersRead(made);

      yield* TestClock.adjust("31 seconds");
      yield* door.admit(yield* throwaway(made, "door-2"));
      assert.strictEqual(membersRead(made) - before, 1);
    }),
  );

  it.effect("is unavailable when that read fails, though a read verb is still answered", () =>
    Effect.gen(function* () {
      const made = world();
      const { door, roles } = yield* services(made);
      yield* door.admit(yield* throwaway(made, "door-1"));

      // KRLS's member list failing, as an empty answer.
      made.members.set("ORG", []);
      yield* TestClock.adjust("31 seconds");
      const refused = yield* Effect.flip(door.admit(yield* throwaway(made, "door-2")));
      assert.strictEqual(refused._tag, "ZeropsUnavailable");
      assert.deepStrictEqual(
        (yield* roles.view).members.map((row) => row.userId),
        ["owner"],
      );
    }),
  );
});
