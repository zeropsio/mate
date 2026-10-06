import { assert, describe, it } from "@effect/vitest";
import type { HqSubscription } from "@t3tools/shared/hqStream";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Backup } from "./backup.ts";
import { Changes, ChangeRefused } from "./changes.ts";
import { DeployKeys } from "./deployKeys.ts";
import { Deploys } from "./deploys.ts";
import { GitHost } from "./gitHost.ts";
import { HqScopes, HqOperationReader, hqScopesLayer, type ScopeOutput } from "./hqScopes.ts";
import { Leader } from "./leader.ts";
import { makeMateOverviews, MateOverviews } from "./mateOverviews.ts";
import { Official, type OfficialStatus } from "./official.ts";
import { mateOffers } from "./offers.ts";
import { Releases } from "./releases.ts";
import { Roles, type OrgView } from "./roles.ts";
import { Structure, type StructureRead, type StructureSource } from "./structure.ts";
import { memoryStore, overviewOf, mainAt } from "../test/harness/overviews.ts";

const nav = { kind: "navigation" } as const;
const attention = { kind: "attention", projectId: "P" } as const;
const facts: OrgView<"cached"> = {
  orgId: "ORG",
  freshness: "cached",
  members: ["owner", "reader", "signer"].map((userId) => ({
    userId,
    name: userId,
    clientUserId: `C-${userId}`,
    kind: "person",
    status: "ACTIVE",
    roleCode: userId === "owner" ? "OWNER" : userId === "reader" ? "READ_ONLY" : "NO_ACCESS",
    canCreateProjects: false,
  })),
  projects: [
    {
      id: "P",
      name: "Project",
      orgId: "ORG",
      status: "ACTIVE",
      tags: [],
      publicZone: "p",
      userRoles: [{ clientUserId: "C-owner", roleCode: "OWNER" }],
    },
  ],
};
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const fixture = Effect.gen(function* () {
  let org = facts;
  let deleted = false;
  let corrupt = false;
  let appName = "App";
  let detailRefused = false;
  let granted = false;
  let revoked = false;
  let gate: Effect.Effect<void> = Effect.void;
  let recipeMarker = 0;
  const readingDetail = yield* Deferred.make<void>();
  const rolesPaused = yield* Deferred.make<void>();
  let rolesRead = 0;
  let pauseRolesAt: number | undefined;
  let rolesGate: Effect.Effect<void> = Effect.void;
  const roleView = Effect.gen(function* () {
    rolesRead += 1;
    if (rolesRead === pauseRolesAt) {
      yield* Deferred.succeed(rolesPaused, undefined);
      yield* rolesGate;
    }
    return org;
  });
  const reads = yield* Ref.make(0);
  const detailReads: string[] = [];
  const recipeRead = yield* Queue.unbounded<string>();
  const structureChanged = yield* PubSub.unbounded<number>();
  const rolesChanged = yield* PubSub.unbounded<{
    readonly view: OrgView<"cached">;
    readonly answered: number;
  }>();
  const detailsChanged = yield* PubSub.unbounded<number>();
  const official = yield* Ref.make<OfficialStatus>({ official: "ok", allowed: true });
  const checked = yield* Ref.make(true);
  const backup = yield* Ref.make({ state: "pending" as const });
  const overviews = yield* makeMateOverviews(memoryStore().store);
  const sourceNow = (): StructureSource => ({
    facts: org,
    appIds: new Set(deleted ? [] : ["A"]),
    projectIds: new Set(deleted ? [] : ["P"]),
    pressProjectIds: new Set(),
    forPerson: (userId) => {
      const can = mateOffers(userId, "P", "mate", org);
      return {
        can: {
          create_app: { allow: true },
          rename_app: { allow: true },
          delete_app: { allow: true },
        },
        unheld: {},
        presses: {},
        ungrouped: [],
        apps: deleted
          ? []
          : [
              {
                id: "A",
                name: appName,
                contents: { empty: false, deletingProjectIds: [] },
                births: [],
                projects: [
                  {
                    projectId: "P",
                    name: "Project",
                    kind: "mate",
                    mate: {
                      face: corrupt ? 7 : "face",
                      madeBy: "owner",
                      standupRequestedBy: null,
                      closedOff: false,
                      keyWider: false,
                    },
                    can,
                  },
                ],
                can: {
                  read_change:
                    (userId === "owner" || granted) && !revoked
                      ? { allow: true }
                      : { allow: false, reason: "forbidden" },
                  comment_change: { allow: false, reason: "forbidden" },
                  merge_change: { allow: false, reason: "forbidden" },
                  close_change: { allow: false, reason: "forbidden" },
                  redeploy: { allow: false, reason: "forbidden" },
                  release: { allow: false, reason: "forbidden" },
                },
                environments: [],
              },
            ],
      } as unknown as StructureRead;
    },
  });
  const services = Layer.mergeAll(
    Layer.succeed(Structure, {
      navigation: Effect.gen(function* () {
        yield* Ref.update(reads, (n) => n + 1);
        return sourceNow();
      }),
      changes: Stream.fromPubSub(structureChanged),
      moveDestinations: () => Effect.succeed({ A: ["mate"] }),
    } as unknown as Structure["Service"]),
    Layer.succeed(Roles, {
      view: roleView,
      recent: Effect.sync(() => org),
      views: Stream.fromPubSub(rolesChanged),
      answeredAt: Effect.succeed(0),
    } as unknown as Roles["Service"]),
    Layer.succeed(Changes, {
      changes: Stream.fromPubSub(detailsChanged),
      readRecipe: (_user: string, _app: string, tier: string) =>
        Effect.gen(function* () {
          detailReads.push(tier);
          yield* Queue.offer(recipeRead, tier);
          yield* Deferred.succeed(readingDetail, undefined);
          yield* gate;
          if (tier === "mate" && detailRefused)
            return yield* new ChangeRefused({ code: "invalid", reason: "recipe_too_large" });
          return { state: "absent" as const, marker: recipeMarker };
        }),
      listChanges: () => Effect.succeed([]),
      listRepos: () =>
        Effect.sync(() => {
          detailReads.push("repos");
          return [];
        }),
      listComments: () => Effect.succeed([]),
    } as unknown as Changes["Service"]),
    Layer.succeed(Releases, {
      changes: Stream.empty,
      list: () =>
        Effect.sync(() => {
          detailReads.push("releases");
          return [];
        }),
    } as unknown as Releases["Service"]),
    Layer.succeed(Deploys, { changes: Stream.empty } as unknown as Deploys["Service"]),
    Layer.succeed(MateOverviews, overviews),
    Layer.succeed(Official, {
      status: Ref.get(official),
      checked: Ref.get(checked),
    } as unknown as Official["Service"]),
    Layer.succeed(GitHost, {
      status: Effect.succeed({ git: "open", quarantined: [] }),
    } as unknown as GitHost["Service"]),
    Layer.succeed(Backup, { status: Ref.get(backup) } as unknown as Backup["Service"]),
    Layer.succeed(DeployKeys, {
      state: "ok",
      status: Effect.succeed("ok"),
    } as unknown as DeployKeys["Service"]),
    Layer.succeed(SqlClient.SqlClient, (() =>
      Effect.succeed([])) as unknown as SqlClient.SqlClient),
    Layer.succeed(Leader, {
      write: (effect: Effect.Effect<unknown>) => effect,
    } as unknown as Leader["Service"]),
  );
  const context = yield* Layer.build(
    hqScopesLayer("BUILD", Duration.seconds(30)).pipe(Layer.provide(services)),
  );
  const hub = Context.get(context, HqScopes);
  const connect = (userId: string) =>
    Effect.gen(function* () {
      const client = yield* hub.open(userId);
      const queue = yield* Queue.unbounded<ScopeOutput>();
      yield* Effect.forkScoped(
        Stream.runForEach(client.messages, (message) => Queue.offer(queue, message)),
      );
      const take = Queue.take(queue);
      const subscribe = (scopes: ReadonlyArray<HqSubscription>) =>
        client.request({ type: "subscribe", scopes });
      return { ...client, queue, take, subscribe };
    });
  return {
    hub,
    connect,
    reads,
    detailReads,
    recipeRead,
    overviews,
    official,
    checked,
    backup,
    renamed: (name: string) =>
      Effect.andThen(
        Effect.sync(() => {
          appName = name;
        }),
        PubSub.publish(structureChanged, 1),
      ),
    pauseRoleRead: (gate: Effect.Effect<void>) => {
      rolesRead = 0;
      pauseRolesAt = 1;
      rolesGate = gate;
    },
    rolesPaused,
    sourceChangeWithoutSignal: Effect.sync(() => {
      appName = "Subscribed change";
      org = {
        ...org,
        members: org.members.map((member) => ({ ...member, name: `${member.name} changed` })),
      };
    }),
    damage: Effect.andThen(
      Effect.sync(() => {
        corrupt = true;
        appName = "Healthy sibling";
      }),
      PubSub.publish(structureChanged, 1),
    ),
    remove: Effect.andThen(
      Effect.sync(() => {
        deleted = true;
      }),
      PubSub.publish(structureChanged, 1),
    ),
    roles: (next: OrgView<"cached">) =>
      Effect.andThen(
        Effect.sync(() => {
          org = next;
        }),
        PubSub.publish(rolesChanged, { view: next, answered: 1 }),
      ),
    grantApp: Effect.andThen(
      Effect.sync(() => {
        granted = true;
      }),
      PubSub.publish(structureChanged, 1),
    ),
    blockDetail: (effect: Effect.Effect<void>) => {
      gate = effect;
    },
    readingDetail,
    revokeApp: Effect.andThen(
      Effect.sync(() => {
        revoked = true;
        appName = "Revoked";
      }),
      PubSub.publish(structureChanged, 1),
    ),
    detailChanged: PubSub.publish(detailsChanged, 1),
    detailValuesChanged: Effect.andThen(
      Effect.sync(() => {
        recipeMarker += 1;
      }),
      PubSub.publish(detailsChanged, 1),
    ),
    mateUnreadable: () => {
      detailRefused = true;
    },
  };
});
const resetOf = (message: ScopeOutput) => {
  if (message.type !== "scope-reset" && message.type !== "scope-values")
    throw new Error("expected scope delivery");
  return message;
};

describe("revisioned HQ values", () => {
  it.effect(
    "navigation is shared and never hydrates app detail; demanded detail shares its reads",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const first = yield* f.connect("owner");
          const other = yield* f.connect("owner");
          yield* first.subscribe([{ scope: nav }]);
          yield* other.subscribe([{ scope: nav }]);
          assert.strictEqual(yield* Ref.get(f.reads), 1);
          assert.deepStrictEqual(f.detailReads, []);
          resetOf(yield* first.take);
          yield* first.take;
          resetOf(yield* other.take);
          yield* other.take;
          const detail = { kind: "app-detail", appId: "A" } as const;
          yield* first.subscribe([{ scope: detail }]);
          yield* other.subscribe([{ scope: detail }]);
          assert.sameMembers(f.detailReads, ["mate", "stage", "production", "repos", "releases"]);
          const reset = resetOf(yield* first.take);
          assert.include(json(reset.values), '"recipe:stage"');
          assert.strictEqual(reset.scope.kind, "app-detail");
        }),
      ),
  );
  it.effect("retains unchanged segments without recomputing and replays missed values", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        const first = resetOf(yield* client.take);
        yield* client.take;
        yield* f.renamed("Renamed");
        const changed = resetOf(yield* client.take);
        assert.include(json(changed.values), "Renamed");
        yield* client.subscribe([
          { scope: nav, cursor: first, knownKeys: first.values.map((value) => value.key) },
        ]);
        assert.deepStrictEqual(yield* client.take, changed);
        yield* client.take;
        const reads = yield* Ref.get(f.reads);
        yield* TestClock.adjust("100 seconds");
        yield* client.subscribe([
          { scope: nav, cursor: changed, knownKeys: first.values.map((value) => value.key) },
        ]);
        assert.strictEqual((yield* client.take).type, "scope-ready");
        assert.strictEqual(yield* Ref.get(f.reads), reads);
      }),
    ),
  );
  it.effect(
    "corrupt navigation records retain their previous value; proven deletion is explicit",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const client = yield* f.connect("owner");
          yield* client.subscribe([{ scope: nav }]);
          const before = resetOf(yield* client.take);
          yield* client.take;
          yield* f.damage;
          resetOf(yield* client.take);
          // A command is a barrier through the same hub semaphore, with no timed polling.
          yield* client.subscribe([{ scope: nav }]);
          const after = resetOf(yield* client.take);
          yield* client.take;
          assert.deepStrictEqual(
            after.values.find((value) => value.key === "project:P"),
            before.values.find((value) => value.key === "project:P"),
          );
          assert.deepStrictEqual(after.removals, []);
          yield* f.remove;
          const removed = resetOf(yield* client.take);
          assert.sameDeepMembers(
            [...removed.removals],
            [
              { key: "app:A", reason: "deleted" },
              { key: "project:P", reason: "deleted" },
              { key: "person:owner", reason: "no-access" },
            ],
          );
        }),
      ),
  );
  it.effect("a refused scope cannot break navigation or be revived by reconnect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("reader");
        const detail = { kind: "app-detail", appId: "A" } as const;
        yield* client.subscribe([{ scope: detail }, { scope: nav }]);
        assert.strictEqual((yield* client.take).type, "scope-error");
        assert.strictEqual((yield* client.take).type, "scope-reset");
        yield* client.take;
        const other = yield* f.connect("reader");
        yield* other.subscribe([{ scope: detail }]);
        assert.strictEqual((yield* other.take).type, "scope-error");
        assert.deepStrictEqual(f.detailReads, []);
      }),
    ),
  );
  it.effect("an unavailable operation reader never proves deletion of retained keys", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([
          { scope: { kind: "operation", appId: "A" }, knownKeys: ["A:operation"] },
        ]);
        const message = yield* client.take;
        assert.strictEqual(message.type, "scope-error");
        if (message.type === "scope-error") assert.strictEqual(message.code, "unsupported");
      }),
    ),
  );
  it.effect("a detail read overtaken by a permission revoke never publishes protected values", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        yield* client.take;
        const gate = yield* Deferred.make<void>();
        f.blockDetail(Deferred.await(gate));
        const started = yield* Effect.forkScoped(
          client.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]),
        );
        yield* Deferred.await(f.readingDetail);
        yield* f.revokeApp;
        assert.include(json(resetOf(yield* client.take).values), "Revoked");
        yield* Deferred.succeed(gate, undefined);
        const next = yield* client.take;
        assert.strictEqual(next.type, "scope-error");
        if (next.type === "scope-error") assert.strictEqual(next.code, "forbidden");
        yield* Fiber.join(started);
      }),
    ),
  );
  it.effect("a Mate tier it cannot read leaves the other app detail values intact", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.mateUnreadable();
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]);
        const read = resetOf(yield* client.take);
        assert.notInclude(json(read.values), '"recipe:mate"');
        assert.include(json(read.values), '"recipe:stage"');
      }),
    ),
  );
  it.effect(
    "overview attention values read no structure; names include the last signer, never a token",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const link = yield* f.overviews.connect("P");
          yield* f.overviews.report("P", link, {
            type: "overview",
            full: true,
            overview: overviewOf({
              logins: {
                codex: { signedInBy: null, lastSignedInBy: "signer", present: false, token: false },
              },
            }),
          });
          const client = yield* f.connect("owner");
          yield* client.subscribe([{ scope: nav }, { scope: attention }]);
          const navReset = resetOf(yield* client.take);
          yield* client.take;
          resetOf(yield* client.take);
          yield* client.take;
          assert.include(json(navReset.values), '"person:signer"');
          const reads = yield* Ref.get(f.reads);
          yield* f.overviews.report("P", link, {
            type: "overview",
            full: false,
            sections: { main: mainAt("Next step") },
          });
          const moved = resetOf(yield* client.take);
          assert.strictEqual(moved.scope.kind, "attention");
          assert.include(json(moved.values), "Next step");
          assert.strictEqual(yield* Ref.get(f.reads), reads);
        }),
      ),
  );
  it.effect("revokes only the observed scope, retaining access to readable navigation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: attention }]);
        resetOf(yield* client.take);
        yield* client.take;
        yield* f.roles({
          ...facts,
          projects: facts.projects.map((project) => ({
            ...project,
            userRoles: [{ clientUserId: "C-owner", roleCode: "READ_ONLY" }],
          })),
        });
        const removal = resetOf(yield* client.take);
        assert.deepStrictEqual(removal.removals, [{ key: "P", reason: "no-access" }]);
        assert.strictEqual((yield* client.take).type, "scope-error");
      }),
    ),
  );
  it.effect("carries Core build, official verdict and parts, with lightweight changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Ref.set(f.checked, false);
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        const first = resetOf(yield* client.take);
        yield* client.take;
        assert.include(json(first.values), '"build":"BUILD"');
        assert.include(json(first.values), '"official":null');
        assert.include(json(first.values), '"db":"up"');
        const reads = yield* Ref.get(f.reads);
        yield* Ref.set(f.checked, true);
        yield* Ref.set(f.official, { official: "unknown" as const, allowed: true });
        yield* TestClock.adjust("30 seconds");
        const moved = resetOf(yield* client.take);
        assert.include(json(moved.values), '"official":"unknown"');
        assert.strictEqual(yield* Ref.get(f.reads), reads);
      }),
    ),
  );
  it.effect("slow detail reads do not block another renderer's first navigation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const gate = yield* Deferred.make<void>();
        f.blockDetail(Deferred.await(gate));
        const slow = yield* f.connect("owner");
        yield* Effect.forkScoped(slow.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]));
        yield* Deferred.await(f.readingDetail);
        const other = yield* f.connect("owner");
        yield* other.subscribe([{ scope: nav }]);
        assert.strictEqual((yield* other.take).type, "scope-reset");
        yield* Deferred.succeed(gate, undefined);
      }),
    ),
  );
  it.effect("pruning idle journals cannot orphan a subscription still baselining", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const slow = yield* f.connect("owner");
        const gate = yield* Deferred.make<void>();
        f.blockDetail(Deferred.await(gate));
        const pending = yield* Effect.forkScoped(
          slow.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]),
        );
        yield* Deferred.await(f.readingDetail);
        const other = yield* f.connect("reader");
        for (let index = 0; index < 514; index += 1) {
          const scope = { kind: "app-detail", appId: `missing-${index}` } as const;
          yield* other.subscribe([{ scope }]);
          yield* other.take;
          yield* other.request({ type: "unsubscribe", scopes: [scope] });
        }
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(pending);
        yield* slow.take;
        yield* slow.take;
        yield* f.detailValuesChanged;
        assert.include(json(resetOf(yield* slow.take).values), '"marker":1');
      }),
    ),
  );
  it.effect("navigation in the same subscription request does not wait on detail", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        const gate = yield* Deferred.make<void>();
        f.blockDetail(Deferred.await(gate));
        const pending = yield* Effect.forkScoped(
          client.subscribe([{ scope: { kind: "app-detail", appId: "A" } }, { scope: nav }]),
        );
        yield* Deferred.await(f.readingDetail);
        assert.strictEqual(resetOf(yield* client.take).scope.kind, "navigation");
        yield* client.take;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(pending);
      }),
    ),
  );
  it.effect("unsubscribing during baseline cannot resurrect its demand or publish its facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        const scope = { kind: "app-detail", appId: "A" } as const;
        const gate = yield* Deferred.make<void>();
        f.blockDetail(Deferred.await(gate));
        const pending = yield* Effect.forkScoped(client.subscribe([{ scope }]));
        yield* Deferred.await(f.readingDetail);
        yield* client.request({ type: "unsubscribe", scopes: [scope] });
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(pending);
        yield* client.subscribe([{ scope: nav }]);
        assert.strictEqual(resetOf(yield* client.take).scope.kind, "navigation");
      }),
    ),
  );
  it.effect("a subscribing connection broadcasts source changes to sibling renderers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const first = yield* f.connect("owner");
        const other = yield* f.connect("owner");
        yield* first.subscribe([{ scope: nav }]);
        yield* first.take;
        yield* first.take;
        yield* other.subscribe([{ scope: nav }]);
        yield* other.take;
        yield* other.take;
        yield* f.sourceChangeWithoutSignal;
        yield* other.subscribe([{ scope: nav }]);
        assert.include(json(resetOf(yield* first.take).values), "Subscribed change");
      }),
    ),
  );
  it.effect("unsubscribing a navigation resume cannot register its scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        yield* client.take;
        const gate = yield* Deferred.make<void>();
        f.pauseRoleRead(Deferred.await(gate));
        const pending = yield* Effect.forkScoped(
          client.subscribe([{ scope: nav, knownKeys: ["org"] }]),
        );
        yield* Deferred.await(f.rolesPaused);
        yield* client.request({ type: "unsubscribe", scopes: [nav] });
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(pending);
        yield* client.subscribe([{ scope: attention }]);
        assert.strictEqual(resetOf(yield* client.take).scope.kind, "attention");
      }),
    ),
  );
  it.effect(
    "operation scope matches PC's app reader and filters the recipient before reading",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const called: string[] = [];
          const f = yield* fixture.pipe(
            Effect.provideService(HqOperationReader, {
              read: (_user, appId) =>
                Effect.sync(() => {
                  called.push(appId);
                  return [{ key: `${appId}:job`, value: { state: "live" } }];
                }),
            }),
          );
          const owner = yield* f.connect("owner");
          const reader = yield* f.connect("reader");
          const scope = { kind: "operation", appId: "A" } as const;
          yield* owner.subscribe([{ scope }]);
          assert.deepStrictEqual(resetOf(yield* owner.take).values, [
            { key: "A:job", value: { state: "live" } },
          ]);
          yield* reader.subscribe([{ scope }]);
          assert.strictEqual((yield* reader.take).type, "scope-error");
          assert.deepStrictEqual(called, ["A"]);
        }),
      ),
  );
  it.effect("placement can grant app detail access without a roles event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("reader");
        yield* client.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]);
        assert.strictEqual((yield* client.take).type, "scope-error");
        yield* f.grantApp;
        assert.strictEqual((yield* client.take).type, "scope-values");
      }),
    ),
  );
  it.effect("revoked reconnect delivers explicit removal before its refusal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: attention }]);
        const before = resetOf(yield* client.take);
        yield* client.take;
        yield* client.request({ type: "unsubscribe", scopes: [attention] });
        yield* f.roles({
          ...facts,
          projects: facts.projects.map((project) => ({
            ...project,
            userRoles: [{ clientUserId: "C-owner", roleCode: "READ_ONLY" }],
          })),
        });
        yield* client.subscribe([{ scope: attention, cursor: before }]);
        const removal = resetOf(yield* client.take);
        assert.deepStrictEqual(removal.removals, [{ key: "P", reason: "no-access" }]);
        assert.deepStrictEqual(removal.values, []);
        assert.strictEqual((yield* client.take).type, "scope-error");
      }),
    ),
  );

  it.effect("a failed later Mate recipe read leaves its previous fact intact", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        const scope = { kind: "app-detail", appId: "A" } as const;
        yield* client.subscribe([{ scope }]);
        const initial = resetOf(yield* client.take);
        yield* client.take;
        yield* Queue.take(f.recipeRead);
        yield* Queue.take(f.recipeRead);
        yield* Queue.take(f.recipeRead);
        f.mateUnreadable();
        yield* f.detailChanged;
        yield* Queue.take(f.recipeRead);
        yield* Queue.take(f.recipeRead);
        yield* Queue.take(f.recipeRead);
        yield* client.subscribe([{ scope }]);
        const after = resetOf(yield* client.take);
        assert.deepStrictEqual(
          after.values.find((value) => value.key === "recipe:mate"),
          initial.values.find((value) => value.key === "recipe:mate"),
        );
        assert.deepStrictEqual(after.removals, []);
      }),
    ),
  );
  it.effect("HQ computes role, write access, Mine and unseen separately for each person", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.roles({
          ...facts,
          projects: facts.projects.map((project) => ({
            ...project,
            userRoles: [...project.userRoles, { clientUserId: "C-signer", roleCode: "BASIC_USER" }],
          })),
        });
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.reportAttention("P", link, {
          source: { environmentId: "env", incarnation: "boot", revision: 1 },
          mainThreadId: "main",
          lastThreadId: "main",
          working: 0,
          waiting: 0,
          results: [
            { threadId: "main", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
          ],
          questions: [],
          truncated: false,
        });
        const owner = yield* f.connect("owner");
        const signer = yield* f.connect("signer");
        yield* owner.subscribe([{ scope: nav }]);
        const first = resetOf(yield* owner.take);
        yield* owner.take;
        yield* signer.subscribe([{ scope: nav }]);
        const other = resetOf(yield* signer.take);
        yield* signer.take;
        assert.include(json(first.values), '"role":"OWNER","mayWrite":true,"mine":true,"unseen":1');
        assert.include(
          json(other.values),
          '"role":"BASIC_USER","mayWrite":true,"mine":false,"unseen":1',
        );
        yield* owner.request({ type: "seen", projectId: "P", resultIds: ["result", "invented"] });
        assert.include(json(resetOf(yield* owner.take).values), '"unseen":0');
        yield* signer.subscribe([{ scope: nav, cursor: other }]);
        assert.strictEqual((yield* signer.take).type, "scope-ready");
      }),
    ),
  );
});
