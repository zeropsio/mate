import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { Official, anchorVerdict, credentialFits, officialLayer } from "./official.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsOwnToken } from "./zerops/api.ts";

const SELF = { projectId: "P1", address: "https://p1zone.prg1-zerops.zone" };
const OWN = "mate-hq:P1:https://p1zone.prg1-zerops.zone";

const token = (name: string, roleCode = "ADMIN", status = "ACTIVE"): ZeropsMember => ({
  name,
  kind: "token",
  roleCode,
  status,
  userId: `U-${name}`,
  clientUserId: `C-${name}`,
  canCreateProjects: false,
});

describe("anchorVerdict", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly members: ReadonlyArray<ZeropsMember>;
    readonly self?: { readonly projectId: string; readonly address: string };
    readonly verdict: ReturnType<typeof anchorVerdict>;
  }> = [
    {
      name: "no anchor at all",
      members: [token("mate-hq-org:P1", "READ_ONLY")],
      verdict: "anchor_missing",
    },
    { name: "the own anchor", members: [token(OWN)], verdict: "ok" },
    { name: "the own anchor with a trailing slash", members: [token(`${OWN}/`)], verdict: "ok" },
    {
      name: "the own name on a person",
      members: [{ ...token(OWN), kind: "person" }],
      verdict: "anchor_missing",
    },
    {
      name: "the own name without the Admin role",
      members: [token(OWN, "READ_ONLY")],
      verdict: "anchor_missing",
    },
    {
      name: "the own name, not active",
      members: [token(OWN, "ADMIN", "WAITING_AUTHORIZATION")],
      verdict: "anchor_missing",
    },
    {
      name: "own project, another address",
      members: [token("mate-hq:P1:https://old.example")],
      verdict: "anchor_missing",
    },
    {
      name: "an anchor of another project",
      members: [token("mate-hq:P2:https://x.example")],
      verdict: "anchor_elsewhere",
    },
    {
      name: "the own anchor beside another project's",
      members: [token(OWN), token("mate-hq:P2:https://x.example")],
      verdict: "anchor_elsewhere",
    },
    {
      name: "another project's token, inactive (fail closed)",
      members: [
        token(OWN),
        token("mate-hq:P2:https://x.example", "ADMIN", "WAITING_AUTHORIZATION"),
      ],
      verdict: "anchor_elsewhere",
    },
    {
      name: "a person named like another project's anchor is no anchor",
      members: [token(OWN), { ...token("mate-hq:P2:https://x.example"), kind: "person" }],
      verdict: "ok",
    },
    {
      name: "another project's without the Admin role",
      members: [token(OWN), token("mate-hq:P2:https://x.example", "READ_ONLY")],
      verdict: "ok",
    },
  ];
  for (const { name, members, self, verdict } of cases) {
    it(`${name}: ${verdict}`, () => {
      assert.strictEqual(anchorVerdict(self ?? SELF, members), verdict);
    });
  }
});

describe("credentialFits", () => {
  const fitting: ZeropsOwnToken = {
    id: "T",
    name: "mate-hq-org:P1",
    orgId: "ORG",
    roleCode: "READ_ONLY",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: null,
    readAtMs: 0,
  };
  const cases: ReadonlyArray<readonly [string, ZeropsOwnToken, boolean]> = [
    ["org Read only, no grant, no flag", fitting, true],
    ["another org", { ...fitting, orgId: "OTHER" }, false],
    ["org Admin", { ...fitting, roleCode: "ADMIN" }, false],
    ["can create projects", { ...fitting, canCreateProjects: true }, false],
    ["sees finances", { ...fitting, canViewFinances: true }, false],
    ["edits finances", { ...fitting, canEditFinances: true }, false],
    [
      "a project grant",
      { ...fitting, projects: [{ projectId: "P1", roleCode: "BASIC_USER" }] },
      false,
    ],
  ];
  for (const [name, own, fits] of cases) {
    it(`${name}: ${String(fits)}`, () => {
      assert.strictEqual(credentialFits(own, "ORG"), fits);
    });
  }
});

/** A rig-like world: Core's fitting token, the HQ project, and whatever anchors a test adds. */
const world = () => {
  const fake = emptyWorld();
  fake.tokens.set("org-token", {
    id: "T1",
    name: "mate-hq-org:P1",
    orgId: "ORG",
    roleCode: "READ_ONLY",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: null,
  });
  fake.tokens.set("admin-token", { ...fake.tokens.get("org-token")!, id: "T2", roleCode: "ADMIN" });
  fake.members.set("ORG", [token("mate-hq-org:P1", "READ_ONLY")]);
  fake.projects.push({
    id: "P1",
    orgId: "ORG",
    name: "mate-rig-hq",
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: "p1zone.prg1-zerops.zone",
  });
  return fake;
};

const official = (fake: FakeWorld, credential: string | null = "org-token") =>
  Layer.build(
    officialLayer({
      projectId: SELF.projectId,
      credential: credential === null ? Option.none() : Option.some(Redacted.make(credential)),
    }).pipe(Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(fake)))),
  ).pipe(Effect.map((context) => Context.get(context, Official)));

/** Moves the test clock and lets the recheck run. */
const after = (duration: Duration.Input) =>
  Effect.andThen(TestClock.adjust(duration), Effect.yieldNow);

describe("officialLayer", () => {
  it.effect("is anchor_missing until the anchor is minted, ok within one recheck", () =>
    Effect.gen(function* () {
      const fake = world();
      const service = yield* official(fake);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* service.status, { official: "anchor_missing", allowed: false });
      fake.members.get("ORG")!.push(token(OWN));
      yield* after("29 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "anchor_missing", allowed: false });
      yield* after("1 second");
      assert.deepStrictEqual(yield* service.status, { official: "ok", allowed: true });
    }),
  );

  it.effect("its address is its project's own domain, not the zerops.app subdomain", () =>
    Effect.gen(function* () {
      const fake = world();
      fake.members.get("ORG")!.push(token("mate-hq:P1:https://hq-30db-8080.prg1.zerops.app"));
      const service = yield* official(fake);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* service.status, { official: "anchor_missing", allowed: false });
      fake.members.get("ORG")!.push(token(OWN));
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "ok", allowed: true });
    }),
  );

  it.effect("is anchor_elsewhere while a decoy stands, ok again once it is gone", () =>
    Effect.gen(function* () {
      const fake = world();
      fake.members.get("ORG")!.push(token(OWN));
      const service = yield* official(fake);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* service.status, { official: "ok", allowed: true });
      fake.members.get("ORG")!.push(token("mate-hq:P2:https://decoy.invalid"));
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, {
        official: "anchor_elsewhere",
        allowed: false,
      });
      fake.members.get("ORG")!.pop();
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "ok", allowed: true });
    }),
  );

  it.effect("is credentials_wrong with no credential, a bogus one, or one above Read only", () =>
    Effect.gen(function* () {
      for (const credential of [null, "bogus", "admin-token"]) {
        const fake = world();
        fake.members.get("ORG")!.push(token(OWN));
        const service = yield* official(fake, credential);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(yield* service.status, {
          official: "credentials_wrong",
          allowed: false,
        });
      }
    }),
  );

  // F18: a Core with no answer of its own yet — a takeover while Zerops is slow — takes the ok the
  // Core that led before read, as `hq_leader` records it (`leader.ts`), under the same grace.
  it.effect.each<{
    readonly name: string;
    readonly inherited: { readonly secondsAgo: number; readonly projectId: string };
    /** Its own answer came first: `anchor_elsewhere`, a decoy standing; then Zerops went quiet. */
    readonly answered?: true;
    readonly allowed: boolean;
  }>([
    {
      name: "its project's ok, 20 s old",
      inherited: { secondsAgo: 20, projectId: "P1" },
      allowed: true,
    },
    // A database restored into another project carries its HQ's ok, which is not this one's.
    {
      name: "another project's ok",
      inherited: { secondsAgo: 20, projectId: "P2" },
      allowed: false,
    },
    {
      name: "its project's ok, as old as the grace",
      inherited: { secondsAgo: 600, projectId: "P1" },
      allowed: false,
    },
    // Its own answer rules from then on, as an `ok` of its own would.
    {
      name: "its project's ok, once it answered",
      inherited: { secondsAgo: 20, projectId: "P1" },
      answered: true,
      allowed: false,
    },
  ])(
    "with no answer of its own, takes the predecessor's ok: $name",
    ({ inherited, answered, allowed }) =>
      Effect.gen(function* () {
        const fake = world();
        fake.members.get("ORG")!.push(token(OWN));
        if (answered) fake.members.get("ORG")!.push(token("mate-hq:P2:https://decoy.invalid"));
        fake.down = answered === undefined;
        const service = yield* official(fake);
        yield* Effect.yieldNow;
        fake.down = true;
        yield* after("10 minutes");
        yield* service.inherit({
          at: (yield* Clock.currentTimeMillis) - inherited.secondsAgo * 1000,
          projectId: inherited.projectId,
        });
        assert.deepStrictEqual(yield* service.status, { official: "unknown", allowed });
      }),
  );

  // What the leader records for its successor (`leader.ts`): the newest ok, its own or inherited.
  it.effect("tells its newest ok, its own or inherited, and none after a refusal", () =>
    Effect.gen(function* () {
      const fake = world();
      fake.members.get("ORG")!.push(token(OWN));
      fake.down = true;
      const service = yield* official(fake);
      yield* Effect.yieldNow;
      assert.strictEqual(yield* service.lastOk, undefined);
      yield* service.inherit({ at: -5000, projectId: "P1" });
      assert.deepStrictEqual(yield* service.lastOk, { at: -5000, projectId: "P1" });
      fake.down = false;
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.lastOk, { at: 30_000, projectId: "P1" });
      fake.members.get("ORG")!.pop();
      yield* after("30 seconds");
      assert.strictEqual(yield* service.lastOk, undefined);
    }),
  );

  it.effect("keeps an ok through an unreachable platform for ten minutes, never a refusal", () =>
    Effect.gen(function* () {
      const fake = world();
      fake.members.get("ORG")!.push(token(OWN));
      const service = yield* official(fake);
      yield* Effect.yieldNow;
      fake.down = true;
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "unknown", allowed: true });
      yield* after("569 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "unknown", allowed: true });
      yield* after("1 second");
      assert.deepStrictEqual(yield* service.status, { official: "unknown", allowed: false });
      fake.down = false;
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "ok", allowed: true });

      fake.members.get("ORG")!.pop();
      yield* after("30 seconds");
      fake.down = true;
      yield* after("30 seconds");
      assert.deepStrictEqual(yield* service.status, { official: "unknown", allowed: false });
    }),
  );
});
