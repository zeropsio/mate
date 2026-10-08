import { assert, describe, it } from "@effect/vitest";
import type { HqNavigationJob, HqSubscription } from "@t3tools/shared/hqStream";
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
import * as SqlClient from "effect/sql/SqlClient";
import { AutoUpdatePolicy } from "./autoUpdate.ts";
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
import { ZeropsRefused, ZeropsUnavailable } from "./zerops/api.ts";
import * as Socket from "effect/socket/Socket";
import { liveSocketsLayer, serveHqSocket } from "./stream.ts";

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
const menuChange = {
  repo: "appdev",
  number: 1,
  mateProjectId: "P",
  title: "Add a login page",
  state: "open",
  hasHead: true,
  updatedAt: "2026-10-06T00:00:00.000Z",
  mergeability: "conflict",
  ready: false,
} as const;
const fixture = Effect.gen(function* () {
  let org = facts;
  let policy = { orgId: "ORG", enabled: true, revision: 0 };
  const policyChanges = yield* PubSub.unbounded<number>();
  let compareFailure: "forbidden" | "unavailable" | undefined;
  const compareCalls: Array<ReadonlyArray<unknown>> = [];
  let sourceRefused = false;
  let sourceUnavailable = false;
  let recentRefused = false;
  let recentReads = 0;
  let savedSigners: Readonly<Record<string, string>> | undefined;
  let otherApp = false;
  let menu: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>> = {};
  let menuReads = 0;
  let changeDetailReads = 0;
  let deleted = false;
  let corrupt = false;
  let appName = "App";
  let environmentState: HqNavigationJob["state"] = "building";
  let environmentReads = 0;
  let environmentsEnabled = false;
  const environmentSnapshot = (): StructureSource["environmentSource"] => {
    const environments = environmentsEnabled
      ? [
          {
            projectId: "P",
            tier: "stage" as const,
            name: "stage",
            sources: ["main"],
            order: 1,
            keyHeld: true,
            keyInvalid: false,
            jobs: [
              {
                id: "job",
                kind: "deploy" as const,
                service: "web",
                sha: "sha",
                state: environmentState,
                cause: "merge" as const,
                ref: "sha",
                reason: null,
                appVersionId: "version",
                processId: "process",
                evidence: {
                  phase: environmentState,
                  processes: [
                    {
                      id: "process",
                      status: environmentState === "building" ? "RUNNING" : "FINISHED",
                    },
                  ],
                  version: null,
                  nextActor: environmentState === "building" ? ("hq" as const) : ("none" as const),
                  nextAction: "Follow operation",
                },
                steps: [],
                verifiedVersionId: null,
                requestedBy: "owner",
                at: "2026-10-06T00:00:00.000Z",
                endedAt: environmentState === "building" ? null : "2026-10-06T00:01:00.000Z",
                supersededBy: null,
              },
            ],
            release: null,
            birth: { ended: false },
          },
        ]
      : [];
    return {
      fingerprints: new Map(environmentsEnabled ? [["A", json(environments)]] : []),
      forApp: (
        _user: string,
        _app: string,
        _facts: unknown,
        access: StructureRead["apps"][number]["can"]["read_change"],
      ) =>
        access.allow
          ? environments.map((environment) => ({
              ...environment,
              can: { keep_deploy_token: { allow: true } },
            }))
          : { refused: access.reason },
    };
  };
  let detailRefused = false;
  let missingChange = true;
  let granted = false;
  let revoked = false;
  let gate: Effect.Effect<void> = Effect.void;
  let recipeMarker = 0;
  const readingDetail = yield* Deferred.make<void>();
  const rolesPaused = yield* Deferred.make<void>();
  let rolesRead = 0;
  let projections = 0;
  let pauseRolesAt: number | undefined;
  let failPausedRole = false;
  let rolesGate: Effect.Effect<void> = Effect.void;
  const roleView = Effect.gen(function* () {
    rolesRead += 1;
    if (sourceUnavailable)
      return yield* new ZeropsUnavailable({ operation: "organization", message: "Unavailable" });
    if (sourceRefused)
      return yield* new ZeropsRefused({
        operation: "organization",
        reason: "forbidden",
        status: 403,
        code: "platform_denied",
      });
    if (rolesRead === pauseRolesAt) {
      yield* Deferred.succeed(rolesPaused, undefined);
      yield* rolesGate;
      if (failPausedRole) {
        failPausedRole = false;
        return yield* new ZeropsRefused({
          operation: "organization",
          reason: "forbidden",
          status: 403,
          code: "denied",
        });
      }
    }
    return org;
  });
  const reads = yield* Ref.make(0);
  const detailReads: string[] = [];
  const sqlReads: Array<{ query: string; values: ReadonlyArray<unknown> }> = [];
  const recipeRead = yield* Queue.unbounded<string>();
  const structureChanged = yield* PubSub.unbounded<number>();
  const rolesChanged = yield* PubSub.unbounded<{
    readonly view: OrgView<"cached">;
    readonly answered: number;
  }>();
  const detailsChanged = yield* PubSub.unbounded<number>();
  const deployChanged = yield* PubSub.unbounded<number>();
  const official = yield* Ref.make<OfficialStatus>({ official: "ok", allowed: true });
  const checked = yield* Ref.make(true);
  const backup = yield* Ref.make({ state: "pending" as const });
  const overviews = yield* makeMateOverviews(memoryStore().store);
  const sourceNow = (): StructureSource => ({
    environmentSource: environmentSnapshot(),
    facts: org,
    appIds: new Set(deleted ? [] : otherApp ? ["A", "B"] : ["A"]),
    projectIds: new Set(deleted ? [] : ["P"]),
    pressProjectIds: new Set(),
    forPerson: (userId) => {
      projections += 1;
      const can = mateOffers(userId, "P", "mate", org);
      const read = {
        can: {
          create_app: { allow: true },
          rename_app: { allow: true },
          delete_app: { allow: true },
        },
        unheld: {},
        presses: environmentsEnabled
          ? {
              P: {
                kind: "stage",
                appId: "A",
                heldForMs: 9000,
                until: "2026-10-06T00:01:00.000Z",
                importProcessId: "import",
              },
            }
          : {},
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
                      ...(savedSigners === undefined ? {} : { signers: savedSigners }),
                      face: corrupt ? 7 : "face",
                      madeBy: "owner",
                      standupRequestedBy: null,
                      closedOff: false,
                      setupMarker: null,
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
                environments: environmentSnapshot().forApp(userId, "A", org, {
                  allow: (userId === "owner" || granted) && !revoked,
                  reason: "changes_not_seen",
                }),
              },
            ],
      } as unknown as StructureRead;
      return {
        ...read,
        apps:
          otherApp && !deleted
            ? [...read.apps, { ...read.apps[0]!, id: "B", name: "Other app", projects: [] }]
            : read.apps,
      };
    },
  });
  const services = Layer.mergeAll(
    Layer.succeed(AutoUpdatePolicy, {
      current: Effect.sync(() => policy),
      changes: Stream.fromPubSub(policyChanges),
      read: () => Effect.sync(() => policy),
      set: (_userId, enabled) =>
        Effect.gen(function* () {
          policy = { ...policy, enabled, revision: policy.revision + 1 };
          yield* PubSub.publish(policyChanges, policy.revision);
          return policy;
        }),
    }),
    Layer.succeed(Structure, {
      environments: Effect.sync(() => {
        environmentReads += 1;
        return environmentSnapshot();
      }),
      navigation: Effect.gen(function* () {
        yield* Ref.update(reads, (n) => n + 1);
        return sourceNow();
      }),
      changes: Stream.fromPubSub(structureChanged),
      moveDestinations: () => Effect.succeed({ moveTo: { A: ["mate"] }, refused: {} }),
    } as unknown as Structure["Service"]),
    Layer.succeed(Roles, {
      view: roleView,
      recent: Effect.gen(function* () {
        recentReads += 1;
        if (recentRefused)
          return yield* new ZeropsRefused({
            operation: "organization",
            reason: "forbidden",
            status: 403,
            code: "platform_denied",
          });
        return org;
      }),
      views: Stream.fromPubSub(rolesChanged),
      answeredAt: Effect.succeed(0),
    } as unknown as Roles["Service"]),
    Layer.succeed(Changes, {
      compare: (
        userId: string,
        appId: string,
        repo: string,
        query: { base?: string; head: string },
      ) =>
        Effect.gen(function* () {
          compareCalls.push([userId, appId, repo, query]);
          if (compareFailure === "unavailable")
            return yield* new ZeropsUnavailable({
              operation: "organization",
              message: "Unavailable",
            });
          if (compareFailure === "forbidden")
            return yield* new ChangeRefused({ code: "forbidden", reason: "app_not_seen" });
          return {
            base: query.base ?? null,
            head: query.head,
            commits: [],
            total: 0,
            truncated: false,
          };
        }),
      navigation: Effect.sync(() => {
        menuReads += 1;
        const snapshot = menu;
        return {
          fingerprints: new Map(Object.entries(snapshot).map(([app, rows]) => [app, json(rows)])),
          forApp: (appId: string) => snapshot[appId] ?? [],
        };
      }),
      changes: Stream.fromPubSub(detailsChanged),
      changeDetail: () =>
        Effect.gen(function* () {
          if (missingChange)
            return yield* new ChangeRefused({
              code: "change_not_found",
              reason: "change_not_found",
            });
          return { state: "recreated" };
        }),
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
      listChanges: () =>
        Effect.sync(() => {
          changeDetailReads += 1;
          return [];
        }),
      listRepos: () =>
        Effect.sync(() => {
          detailReads.push("repos");
          return [];
        }),
      listComments: () => Effect.succeed([]),
    } as unknown as Changes["Service"]),
    Layer.succeed(Releases, {
      navigation: Effect.succeed({ fingerprints: new Map(), forApp: () => null }),
      changes: Stream.empty,
      list: () =>
        Effect.sync(() => {
          detailReads.push("releases");
          return [];
        }),
    } as unknown as Releases["Service"]),
    Layer.succeed(Deploys, {
      changes: Stream.fromPubSub(deployChanged),
    } as unknown as Deploys["Service"]),
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
    Layer.succeed(
      SqlClient.SqlClient,
      Object.assign(
        (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) =>
          Effect.sync(() => {
            sqlReads.push({ query: strings.join("?"), values });
            return [];
          }),
        {
          in: (column: string, values: ReadonlyArray<unknown>) => ({ column, values }),
        },
      ) as unknown as SqlClient.SqlClient,
    ),
    Layer.succeed(Leader, {
      write: (effect: Effect.Effect<unknown>) => effect,
    } as unknown as Leader["Service"]),
  );
  const context = yield* Layer.build(
    hqScopesLayer("BUILD", Duration.seconds(30)).pipe(Layer.provide(services)),
  );
  const hub = Context.get(context, HqScopes);
  const connect = (userId: string, sessionId = "session") =>
    Effect.gen(function* () {
      const client = yield* hub.open(userId, sessionId);
      const queue = yield* Queue.unbounded<ScopeOutput>();
      yield* Effect.forkScoped(
        Stream.runForEach(
          client.messages.pipe(Stream.filter((message) => message.type !== "end")),
          (message) => Queue.offer(queue, message),
        ),
      );
      const take = Queue.take(queue);
      const subscribe = (scopes: ReadonlyArray<HqSubscription>) =>
        client.request({ type: "subscribe", scopes });
      return { ...client, queue, take, subscribe };
    });
  return {
    changePolicy: (enabled: boolean) =>
      Effect.gen(function* () {
        policy = { ...policy, enabled, revision: policy.revision + 1 };
        yield* PubSub.publish(policyChanges, policy.revision);
      }),
    compareCalls,
    compareFailure: (failure: typeof compareFailure) => {
      compareFailure = failure;
    },
    otherApp: () => {
      otherApp = true;
    },
    menuReads: () => menuReads,
    changeDetailReads: () => changeDetailReads,
    menuChanges: (value: typeof menu) =>
      Effect.andThen(
        Effect.sync(() => {
          menu = value;
        }),
        PubSub.publish(detailsChanged, 1),
      ),
    savedSigners: (value: Readonly<Record<string, string>>) => {
      savedSigners = value;
    },
    enableEnvironments: () => {
      environmentsEnabled = true;
    },
    environmentReads: () => environmentReads,
    deployState: (state: HqNavigationJob["state"]) =>
      Effect.andThen(
        Effect.sync(() => {
          environmentState = state;
        }),
        PubSub.publish(deployChanged, 1),
      ),
    deployChanged: PubSub.publish(deployChanged, 1),
    recoverSource: () => {
      sourceRefused = false;
      recentRefused = false;
    },
    projections: () => projections,
    recreate: Effect.andThen(
      Effect.sync(() => {
        deleted = false;
      }),
      PubSub.publish(structureChanged, 1),
    ),
    recreateChange: Effect.andThen(
      Effect.sync(() => {
        missingChange = false;
      }),
      PubSub.publish(detailsChanged, 1),
    ),
    unavailableSource: () => {
      sourceUnavailable = true;
    },
    refuseSource: () => {
      sourceRefused = true;
    },
    refuseRecheck: () => {
      recentRefused = true;
    },
    recheckReads: () => recentReads,
    roleReads: () => rolesRead,
    hub,
    connect,
    reads,
    detailReads,
    sqlReads,
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
    failPausedRole: () => {
      failPausedRole = true;
    },
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
    "streams the current automatic-update policy and another admin's change to every member",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const reader = yield* f.connect("reader");
        yield* reader.subscribe([{ scope: nav }]);
        const first = resetOf(yield* reader.take);
        assert.deepStrictEqual(
          first.values.find((value) => value.key === "auto-update-policy")?.value,
          { orgId: "ORG", enabled: true, revision: 0 },
        );
        yield* reader.take; // scope-ready
        yield* f.changePolicy(false);
        const change = resetOf(yield* reader.take);
        assert.deepStrictEqual(change.values, [
          { key: "auto-update-policy", value: { orgId: "ORG", enabled: false, revision: 1 } },
        ]);
        assert.strictEqual(change.incarnation, first.incarnation);
        assert.strictEqual(change.revision, first.revision + 1);
        yield* reader.request({ type: "unsubscribe", scopes: [nav] });
        yield* f.changePolicy(true);
        yield* reader.subscribe([
          { scope: nav, cursor: { incarnation: change.incarnation, revision: change.revision } },
        ]);
        // Subscribe may resume before the already-published change is consumed; its delta follows.
        let answer = yield* reader.take;
        if (answer.type === "scope-ready") answer = yield* reader.take;
        const resumed = resetOf(answer);
        assert.deepStrictEqual(
          resumed.values.find((value) => value.key === "auto-update-policy")?.value,
          { orgId: "ORG", enabled: true, revision: 2 },
        );
      }),
  );
  it.effect("a cold navigation delivery budgets one role read before and one after loading", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        assert.include(json(resetOf(yield* client.take).values), "project:P");
        assert.strictEqual((yield* client.take).type, "scope-ready");
        assert.strictEqual(yield* Ref.get(f.reads), 1);
        assert.isAtMost(f.roleReads(), 2);
      }),
    ),
  );
  it.effect("navigation shares compact menu changes and filters them before person delivery", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.menuChanges({ A: [{ ...menuChange, body: "private description", comments: 99 }] });
        const clients = yield* Effect.forEach(["owner", "reader", "owner"], (userId) =>
          f.connect(userId),
        );
        for (const client of clients) {
          yield* client.subscribe([{ scope: nav }]);
          const baseline = resetOf(yield* client.take);
          yield* client.take;
          const app = baseline.values.find((value) => value.key === "app:A")!.value as {
            changes: unknown;
          };
          assert.deepStrictEqual(
            app.changes,
            client === clients[1] ? { refused: "forbidden" } : [menuChange],
          );
          assert.notInclude(json(baseline.values), '"body"');
        }
        assert.strictEqual(f.menuReads(), 1);
        assert.strictEqual(f.changeDetailReads(), 0);
        assert.deepStrictEqual(f.detailReads, []);
      }),
    ),
  );
  it.effect("change events revise only the affected navigation app without detail hydration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.otherApp();
        yield* f.menuChanges({ A: [menuChange], B: [] });
        const owner = yield* f.connect("owner"),
          reader = yield* f.connect("reader");
        for (const client of [owner, reader]) {
          yield* client.subscribe([{ scope: nav }]);
          yield* client.take;
          yield* client.take;
        }
        const reads = yield* Ref.get(f.reads),
          projections = f.projections(),
          roles = f.roleReads();
        const retitled = { ...menuChange, title: "Login page ready", ready: true };
        yield* f.menuChanges({ A: [retitled], B: [] });
        const moved = resetOf(yield* owner.take);
        assert.deepStrictEqual(
          moved.values.map((value) => value.key),
          ["app:A"],
        );
        assert.deepStrictEqual((moved.values[0]!.value as { changes: unknown }).changes, [
          retitled,
        ]);
        yield* f.menuChanges({ A: [], B: [] });
        const settled = resetOf(yield* owner.take);
        assert.deepStrictEqual((settled.values[0]!.value as { changes: unknown }).changes, []);
        assert.strictEqual(yield* Queue.size(reader.queue), 0);
        assert.strictEqual(yield* Ref.get(f.reads), reads);
        assert.strictEqual(f.projections(), projections);
        assert.strictEqual(f.roleReads(), roles);
        assert.deepStrictEqual(f.detailReads, []);
        assert.strictEqual(f.changeDetailReads(), 0);
        yield* f.menuChanges({ A: [], B: [] });
        yield* owner.subscribe([
          {
            scope: nav,
            cursor: { incarnation: settled.incarnation, revision: settled.revision },
          },
        ]);
        assert.strictEqual((yield* owner.take).type, "scope-ready");
      }),
    ),
  );
  it.effect("person owner, viewer signer, avatars and candidates stay isolated at delivery", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.roles({
          ...facts,
          members: [
            ...facts.members.map((member) => ({ ...member, avatarUrl: `avatar-${member.userId}` })),
            { ...facts.members[0]!, userId: "token", clientUserId: "C-token", kind: "token" },
            {
              ...facts.members[0]!,
              userId: "invited",
              clientUserId: "C-invited",
              status: "INVITED",
            },
          ],
          projects: facts.projects.map((project) => ({
            ...project,
            userRoles: [...project.userRoles, { clientUserId: "C-signer", roleCode: "BASIC_USER" }],
          })),
        });
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf({
            logins: {
              "claude-code": {
                signedInBy: "signer",
                lastSignedInBy: "signer",
                present: true,
                token: false,
              },
              codex: { signedInBy: "owner", lastSignedInBy: "owner", present: true, token: false },
            },
          }),
        });
        const owner = yield* f.connect("owner"),
          signer = yield* f.connect("signer"),
          reader = yield* f.connect("reader");
        for (const [client, mine, waits, signers] of [
          [owner, true, false, { "claude-code": "signer", codex: "owner" }],
          [signer, false, true, { "claude-code": "signer", codex: "owner" }],
          [reader, false, false, {}],
        ] as const) {
          yield* client.subscribe([{ scope: nav }]);
          const delivery = resetOf(yield* client.take);
          yield* client.take;
          const project = delivery.values.find((value) => value.key === "project:P")!.value as {
            person: Record<string, unknown>;
            signedInNow: unknown;
            everSignedIn: unknown;
          };
          assert.strictEqual(project.person.ownerUserId, "owner");
          assert.strictEqual(project.person.mine, mine);
          assert.strictEqual(project.person.waitsOnViewer, waits);
          assert.deepStrictEqual(project.signedInNow, signers);
          assert.deepStrictEqual(project.everSignedIn, signers);
          assert.include(json(delivery.values), '"avatarUrl":"avatar-owner"');
          if (client === reader) assert.notInclude(json(delivery.values), "avatar-signer");
        }
      }),
    ),
  );
  for (const runsWithoutSignIn of [false, true]) {
    it.effect(`sign-in-free=${runsWithoutSignIn}: attention waits on the operating owner`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.roles({
            ...facts,
            projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
          });
          const link = yield* f.overviews.connect("P");
          yield* f.overviews.report("P", link, {
            type: "overview",
            full: true,
            overview: overviewOf({
              identity: { ...overviewOf().identity, runsWithoutSignIn },
            }),
          });
          for (const userId of ["owner", "reader"]) {
            const client = yield* f.connect(userId);
            yield* client.subscribe([{ scope: nav }]);
            const delivery = resetOf(yield* client.take);
            yield* client.take;
            const project = delivery.values.find((value) => value.key === "project:P")!.value as {
              person: { ownerUserId: string | null; waitsOnViewer: boolean };
              signedInNow: unknown;
              everSignedIn: unknown;
            };
            assert.strictEqual(
              project.person.waitsOnViewer,
              runsWithoutSignIn && userId === "owner",
            );
            assert.strictEqual(
              project.person.ownerUserId,
              runsWithoutSignIn && userId === "owner" ? "owner" : null,
            );
            assert.deepStrictEqual(project.signedInNow, {});
            assert.deepStrictEqual(project.everSignedIn, {});
          }
        }),
      ),
    );
  }

  it.effect("navigation separates current login holders from historical and saved signers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.savedSigners({ codex: "owner", "saved-agent": "reader" });
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf({
            logins: {
              "claude-code": {
                signedInBy: null,
                lastSignedInBy: "owner",
                present: false,
                token: false,
              },
              "custom-agent": {
                signedInBy: "reader",
                lastSignedInBy: "signer",
                present: true,
                token: false,
              },
              "stale-agent": { signedInBy: "owner", present: false, token: false },
              "api-key": { signedInBy: "owner", present: true, token: true },
            },
          }),
        });
        for (const user of ["owner", "reader"]) {
          const client = yield* f.connect(user);
          yield* client.subscribe([{ scope: nav }]);
          const project = resetOf(yield* client.take).values.find(
            (value) => value.key === "project:P",
          )!.value as {
            signedInNow: unknown;
            everSignedIn: unknown;
            person: { waitsOnViewer: boolean };
          };
          assert.deepStrictEqual(
            project.signedInNow,
            user === "owner" ? { "custom-agent": "reader" } : {},
          );
          assert.deepStrictEqual(
            project.everSignedIn,
            user === "owner"
              ? {
                  "claude-code": "owner",
                  codex: "owner",
                  "saved-agent": "reader",
                  "custom-agent": "reader",
                  "stale-agent": "owner",
                }
              : {},
          );
          assert.strictEqual(project.person.waitsOnViewer, false);
          assert.notProperty(project, "signers");
        }
      }),
    ),
  );
  for (const failure of [undefined, "forbidden", "unavailable"] as const) {
    it.effect(`compare privately correlates ${failure ?? "success"} without subscribing`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.compareFailure(failure);
          const client = yield* f.connect("owner"),
            other = yield* f.connect("reader");
          const query = { base: "a".repeat(40), head: "b".repeat(40) };
          yield* client.request({
            type: "compare",
            requestId: "r",
            appId: "A",
            repo: "appdev",
            ...query,
          });
          const reply = yield* client.take;
          assert.deepStrictEqual(
            reply,
            failure === undefined
              ? {
                  type: "compare",
                  requestId: "r",
                  appId: "A",
                  repo: "appdev",
                  result: { ...query, commits: [], total: 0, truncated: false },
                }
              : {
                  type: "compare-error",
                  requestId: "r",
                  appId: "A",
                  repo: "appdev",
                  code: failure,
                  reason: failure === "forbidden" ? "app_not_seen" : null,
                  disposition: failure === "forbidden" ? "refused" : "transient",
                },
          );
          assert.deepStrictEqual(f.compareCalls, [["owner", "A", "appdev", query]]);
          assert.strictEqual(yield* Queue.size(other.queue), 0);
          assert.strictEqual(yield* Ref.get(f.reads), 0);
        }),
      ),
    );
  }
  it.effect(
    "handover candidates are on request, org-admin-only and never broadcast to another person",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.roles({
            ...facts,
            members: [
              ...facts.members.map((member) => ({
                ...member,
                avatarUrl: `avatar-${member.userId}`,
              })),
              { ...facts.members[0]!, userId: "token", clientUserId: "C-token", kind: "token" },
              {
                ...facts.members[0]!,
                userId: "invited",
                clientUserId: "C-invited",
                status: "INVITED",
              },
            ],
          });
          const owner = yield* f.connect("owner"),
            reader = yield* f.connect("reader");
          yield* owner.request({
            type: "handover-candidates",
            requestId: "owner-request",
            projectId: "P",
          });
          const candidates = yield* owner.take;
          assert.strictEqual(candidates.type, "handover-candidates");
          if (candidates.type === "handover-candidates")
            assert.deepStrictEqual(
              candidates.candidates.map((person) => person.userId),
              ["owner", "reader", "signer"],
            );
          assert.strictEqual(yield* Queue.size(reader.queue), 0);
          yield* reader.request({
            type: "handover-candidates",
            requestId: "reader-request",
            projectId: "P",
          });
          const refused = yield* reader.take;
          assert.strictEqual(refused.type, "handover-candidates-error");
          assert.notInclude(json(refused), "avatar-signer");
        }),
      ),
  );
  for (const [userId, allowed] of [
    ["signer", false],
    ["owner", true],
  ] as const)
    it.effect(
      `handover candidates ${allowed ? "allow org ADMIN" : "refuse org NO_ACCESS with project Basic access"}`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* fixture;
            const members = facts.members.map((member) => ({
              ...member,
              roleCode: member.userId === "owner" ? "ADMIN" : member.roleCode,
              avatarUrl: `avatar-${member.userId}`,
            }));
            yield* f.roles({
              ...facts,
              members,
              projects: facts.projects.map((project) => ({
                ...project,
                userRoles: [
                  ...project.userRoles,
                  { clientUserId: "C-signer", roleCode: "BASIC_USER" },
                ],
              })),
            });
            const client = yield* f.connect(userId);
            yield* client.subscribe([{ scope: nav }]);
            const navigation = resetOf(yield* client.take);
            yield* client.take;
            const project = navigation.values.find((value) => value.key === "project:P")!.value as {
              can: { observe_mate: { allow: boolean } };
            };
            assert.isTrue(project.can.observe_mate.allow);
            yield* client.request({
              type: "handover-candidates",
              requestId: "handover",
              projectId: "P",
            });
            const reply = yield* client.take;
            assert.deepStrictEqual(
              reply,
              allowed
                ? {
                    type: "handover-candidates",
                    requestId: "handover",
                    projectId: "P",
                    candidates: members.map((member) => ({
                      userId: member.userId,
                      clientUserId: member.clientUserId,
                      name: member.name,
                      avatarUrl: member.avatarUrl,
                    })),
                  }
                : {
                    type: "handover-candidates-error",
                    requestId: "handover",
                    projectId: "P",
                    code: "forbidden",
                    reason: "no-access",
                    disposition: "refused",
                  },
            );
          }),
        ),
    );
  it.effect("saved agent signer facts are withheld from a reader who cannot operate the Mate", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.savedSigners({ "claude-code": "signer", codex: "owner" });
        const owner = yield* f.connect("owner"),
          reader = yield* f.connect("reader");
        yield* owner.subscribe([{ scope: nav }]);
        yield* reader.subscribe([{ scope: nav }]);
        assert.include(json(resetOf(yield* owner.take).values), '"claude-code":"signer"');
        const filtered = resetOf(yield* reader.take);
        assert.notInclude(json(filtered.values), '"signer"');
      }),
    ),
  );
  it.effect(
    "an overview signer change updates project facts and only its newly referenced person",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.roles({
            ...facts,
            projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
          });
          const link = yield* f.overviews.connect("P");
          const owner = yield* f.connect("owner"),
            reader = yield* f.connect("reader");
          yield* owner.subscribe([{ scope: nav }]);
          const first = resetOf(yield* owner.take);
          yield* owner.take;
          yield* reader.subscribe([{ scope: nav }]);
          yield* reader.take;
          yield* reader.take;
          const reads = yield* Ref.get(f.reads),
            projections = f.projections(),
            roles = f.roleReads();
          yield* f.overviews.report("P", link, {
            type: "overview",
            full: true,
            overview: overviewOf({
              logins: {
                codex: { signedInBy: null, lastSignedInBy: "signer", present: false, token: false },
                github: { signedInBy: "reader", lastSignedInBy: null, present: true, token: false },
              },
            }),
          });
          const updated = resetOf(yield* owner.take);
          assert.deepStrictEqual(
            updated.values.map((value) => value.key),
            ["project:P", "person:reader", "person:signer"],
          );
          const project = updated.values[0]!.value as {
            person: { ownerUserId: string | null; waitsOnViewer: boolean };
            signedInNow: unknown;
            everSignedIn: unknown;
          };
          assert.deepStrictEqual(project.signedInNow, { github: "reader" });
          assert.deepStrictEqual(project.everSignedIn, { codex: "signer", github: "reader" });
          assert.strictEqual(project.person.ownerUserId, "signer");
          assert.strictEqual(project.person.waitsOnViewer, false);
          assert.strictEqual(yield* Ref.get(f.reads), reads);
          assert.strictEqual(f.projections(), projections);
          assert.strictEqual(f.roleReads(), roles);
          assert.strictEqual(yield* Queue.size(reader.queue), 0);
          assert.strictEqual(updated.revision, first.revision + 1);
        }),
      ),
  );
  it.effect(
    "handover failure replies distinguish source refusals and outages without exposing candidates",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const unavailable of [false, true]) {
            const f = yield* fixture;
            if (unavailable) f.unavailableSource();
            else f.refuseSource();
            const client = yield* f.connect("owner");
            yield* client.request({
              type: "handover-candidates",
              requestId: "failure",
              projectId: "P",
            });
            const reply = yield* client.take;
            assert.strictEqual(reply.type, "handover-candidates-error");
            if (reply.type === "handover-candidates-error")
              assert.strictEqual(reply.disposition, unavailable ? "transient" : "refused");
            assert.notInclude(json(reply), '"candidates"');
          }
        }),
      ),
  );
  it.effect(
    "a restarted Mate's attention, its next epoch, replaces revision seven with an atomic baseline",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const oldLink = yield* f.overviews.connect("P");
          const value = {
            source: { environmentId: "env", epoch: 1, incarnation: "first", revision: 7 },
            mainThreadId: null,
            lastThreadId: null,
            working: 1,
            waiting: 0,
            results: [],
            questions: [],
            truncated: false,
          };
          yield* f.overviews.reportAttention("P", oldLink, value);
          const client = yield* f.connect("owner");
          yield* client.subscribe([{ scope: attention }]);
          const first = resetOf(yield* client.take);
          yield* client.take;
          const newLink = yield* f.overviews.connect("P");
          const restarted = {
            ...value,
            source: { ...value.source, epoch: 2, incarnation: "second", revision: 0 },
            working: 0,
          };
          yield* f.overviews.reportAttention("P", newLink, restarted);
          let next = resetOf(yield* client.take);
          if (!json(next.values).includes('"incarnation":"second"'))
            next = resetOf(yield* client.take);
          assert.strictEqual(next.type, "scope-reset");
          assert.notStrictEqual(next.incarnation, first.incarnation);
          assert.include(json(next.values), '"epoch":2,"incarnation":"second","revision":0');
          yield* client.subscribe([
            {
              scope: attention,
              cursor: { incarnation: first.incarnation, revision: first.revision },
              knownKeys: ["P"],
            },
          ]);
          const resumed = resetOf(yield* client.take);
          assert.strictEqual(resumed.type, "scope-reset");
          assert.notInclude(json(resumed.values), '"incarnation":"first"');
        }),
      ),
  );
  it.effect("navigation retains filtered environment jobs and press hold duration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.enableEnvironments();
        const owner = yield* f.connect("owner");
        const reader = yield* f.connect("reader");
        yield* owner.subscribe([{ scope: nav }]);
        yield* reader.subscribe([{ scope: nav }]);
        const first = resetOf(yield* owner.take);
        const filtered = resetOf(yield* reader.take);
        const app = first.values.find((value) => value.key === "app:A")!.value as {
          environments: Array<{ jobs: Array<{ state: string; evidence: unknown }> }>;
        };
        assert.strictEqual(app.environments[0]!.jobs[0]!.state, "building");
        assert.property(app.environments[0]!.jobs[0]!, "evidence");
        assert.deepStrictEqual(
          (
            filtered.values.find((value) => value.key === "app:A")!.value as {
              environments: unknown;
            }
          ).environments,
          { refused: "forbidden" },
        );
        assert.strictEqual(
          (first.values.find((value) => value.key === "press:P")!.value as { heldForMs: number })
            .heldForMs,
          9000,
        );
      }),
    ),
  );
  it.effect(
    "deploy pushes revise only changed app environment values without rebuilding navigation or projecting every person",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.enableEnvironments();
          const owner = yield* f.connect("owner");
          const reader = yield* f.connect("reader");
          yield* owner.subscribe([{ scope: nav }]);
          yield* reader.subscribe([{ scope: nav }]);
          const first = resetOf(yield* owner.take);
          yield* owner.take;
          resetOf(yield* reader.take);
          yield* reader.take;
          const projections = f.projections();
          const roles = f.roleReads();
          yield* f.deployState("live");
          const moved = resetOf(yield* owner.take);
          assert.deepStrictEqual(
            moved.values.map((value) => value.key),
            ["app:A"],
          );
          assert.strictEqual(moved.type, "scope-values");
          assert.strictEqual(moved.incarnation, first.incarnation);
          assert.strictEqual(moved.revision, first.revision + 1);
          assert.deepStrictEqual(moved.removals, []);
          assert.include(json(moved.values), '"state":"live"');
          assert.strictEqual(yield* Ref.get(f.reads), 1);
          assert.strictEqual(f.projections(), projections);
          assert.strictEqual(f.roleReads(), roles);
          assert.strictEqual(f.environmentReads(), 1);
          assert.deepStrictEqual(f.detailReads, []);
          assert.strictEqual(yield* Queue.size(reader.queue), 0);
          yield* f.deployChanged;
          // A tick with unchanged values emits no app update. The status tick is a receipt barrier.
          yield* Ref.set(f.official, { official: "anchor_missing" as const, allowed: true });
          yield* TestClock.adjust("30 seconds");
          const status = resetOf(yield* owner.take);
          assert.deepStrictEqual(
            status.values.map((value) => value.key),
            ["status"],
          );
          assert.strictEqual(yield* Ref.get(f.reads), 1);
          assert.strictEqual(f.environmentReads(), 2);
          yield* owner.subscribe([
            {
              scope: nav,
              cursor: { incarnation: status.incarnation, revision: status.revision },
              knownKeys: first.values.map((value) => value.key),
            },
          ]);
          const ready = yield* owner.take;
          assert.strictEqual(ready.type, "scope-ready");
          assert.strictEqual(yield* Queue.size(owner.queue), 0);
        }),
      ),
  );

  it.effect("a new session behind a failing old read still re-evaluates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const gate = yield* Deferred.make<void>();
        f.pauseRoleRead(Deferred.await(gate));
        f.failPausedRole();
        const old = yield* f.connect("owner", "old-session");
        const first = yield* Effect.forkScoped(old.subscribe([{ scope: nav }]));
        yield* Deferred.await(f.rolesPaused);
        const fresh = yield* f.connect("owner", "new-session");
        const next = yield* Effect.forkScoped(fresh.subscribe([{ scope: nav }]), {
          startImmediately: true,
        });
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(next);
        assert.strictEqual((yield* fresh.take).type, "scope-reset");
      }),
    ),
  );
  it.effect("a recreated change clears not-found while a status tick does not", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        const scope = { kind: "change", appId: "A", repo: "repo", number: 1 } as const;
        yield* client.subscribe([{ scope }]);
        const failure = yield* client.take;
        assert.strictEqual(failure.type, "scope-error");
        if (failure.type === "scope-error") assert.strictEqual(failure.code, "change_not_found");
        yield* TestClock.adjust("30 seconds");
        assert.strictEqual(yield* Queue.size(client.queue), 0);
        yield* f.recreateChange;
        assert.deepStrictEqual(resetOf(yield* client.take).values, [
          { key: "repo:1", value: { state: "recreated" } },
        ]);
      }),
    ),
  );
  it.effect("an all-scope person retry does not clear another person's refusal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.refuseSource();
        const owner = yield* f.connect("owner");
        const reader = yield* f.connect("reader");
        yield* owner.subscribe([{ scope: nav }]);
        yield* owner.take;
        yield* reader.subscribe([{ scope: nav }]);
        const failure = yield* reader.take;
        f.recoverSource();
        yield* owner.request({ type: "retry" });
        assert.strictEqual((yield* owner.take).type, "scope-values");
        const reads = f.roleReads();
        yield* reader.subscribe([{ scope: nav }]);
        assert.deepStrictEqual(yield* reader.take, failure);
        assert.strictEqual(f.roleReads(), reads);
      }),
    ),
  );
  it.effect("a source-refused operation keeps a socket carrying readable navigation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture.pipe(
          Effect.provideService(HqOperationReader, {
            read: () =>
              Effect.fail(
                new ZeropsRefused({
                  operation: "operation",
                  reason: "forbidden",
                  status: 403,
                  code: "denied",
                }),
              ),
          }),
        );
        const incoming = yield* Queue.unbounded<readonly [Uint8Array]>();
        const outgoing = yield* Queue.unbounded<string | Socket.CloseEvent>();
        const socket = Socket.make({
          reader: Effect.succeed({ pull: Queue.take(incoming), upgrade: () => Effect.void }),
          writer: Effect.succeed({
            write: (frame) =>
              Queue.offer(outgoing, Socket.isCloseEvent(frame) ? frame : String(frame)).pipe(
                Effect.asVoid,
              ),
            writeAll: () => Effect.void,
          }),
        });
        const serving = yield* Effect.forkScoped(
          serveHqSocket(socket, "owner", Effect.succeed(undefined), {}).pipe(
            Effect.provideService(HqScopes, f.hub),
            Effect.provide(liveSocketsLayer),
          ),
        );
        yield* Queue.offer(incoming, [
          new TextEncoder().encode(
            '{"type":"subscribe","scopes":[{"scope":{"kind":"navigation"}},{"scope":{"kind":"operation","appId":"A"}}]}',
          ),
        ]);
        let ready = false;
        let refused = false;
        while (!ready || !refused) {
          const frame = yield* Queue.take(outgoing);
          assert.isFalse(Socket.isCloseEvent(frame));
          if (typeof frame === "string") {
            ready ||= frame.includes("scope-ready");
            refused ||= frame.includes("zerops_refused");
          }
        }
        assert.isUndefined(serving.pollUnsafe());
        yield* Fiber.interrupt(serving);
      }),
    ),
  );
  it.effect("attention refreshes only observable project facts and loads seen by project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const link = yield* f.overviews.connect("P");
        const value = {
          source: { environmentId: "env", epoch: 1, incarnation: "boot", revision: 1 },
          mainThreadId: "thread",
          lastThreadId: "thread",
          working: 0,
          waiting: 0,
          results: [],
          questions: [],
          truncated: false,
        };
        yield* f.overviews.reportAttention("P", link, value);
        const owner = yield* f.connect("owner");
        const reader = yield* f.connect("reader");
        yield* owner.subscribe([{ scope: nav }]);
        yield* owner.take;
        yield* owner.take;
        yield* reader.subscribe([{ scope: nav }]);
        yield* reader.take;
        yield* reader.take;
        const reads = f.roleReads();
        yield* f.overviews.reportAttention("P", link, {
          ...value,
          source: { ...value.source, revision: 2 },
          results: [
            { threadId: "thread", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
          ],
        });
        assert.deepStrictEqual(
          resetOf(yield* owner.take).values.map((value) => value.key),
          ["project:P"],
        );
        assert.strictEqual(f.roleReads(), reads);
        const queries = f.sqlReads.filter(
          (read) => read.query.includes("SELECT") && read.query.includes("hq_attention_seen"),
        );
        assert.isTrue(
          queries.every(
            (read) =>
              read.query.includes("WHERE user_id =") &&
              read.values[0] === "owner" &&
              json(read.values[1]) === json({ column: "project_id", values: ["P"] }),
          ),
        );
        assert.strictEqual(yield* Queue.size(reader.queue), 0);
      }),
    ),
  );
  it.effect("explicit scoped and all retries reopen a definitive refusal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.refuseSource();
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        const reads = f.roleReads();
        f.recoverSource();
        yield* client.request({ type: "retry", scopes: [nav] });
        assert.isAbove(f.roleReads(), reads);
        assert.strictEqual((yield* client.take).type, "scope-values");
        yield* client.request({ type: "retry" });
      }),
    ),
  );
  it.effect("a new authorized session re-evaluates a refused journal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.refuseSource();
        const before = yield* f.connect("owner", "old-session");
        yield* before.subscribe([{ scope: nav }]);
        yield* before.take;
        f.recoverSource();
        const after = yield* f.connect("owner", "new-session");
        yield* after.subscribe([{ scope: nav }]);
        assert.strictEqual((yield* after.take).type, "scope-reset");
      }),
    ),
  );
  it.effect("changed roles and re-created records clear definitive refusals", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.refuseSource();
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        f.recoverSource();
        yield* f.roles({
          ...facts,
          members: facts.members.map((member) => ({ ...member, name: "changed" })),
        });
        assert.strictEqual((yield* client.take).type, "scope-values");
        yield* f.remove;
        yield* client.take;
        yield* client.subscribe([{ scope: attention }]);
        yield* client.take;
        yield* f.recreate;
        const link = yield* f.overviews.connect("P");
        yield* f.overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        // Navigation and attention regain their own values, never another person's journal.
        let regained = false;
        while (!regained) {
          const message = yield* client.take;
          regained =
            (message.type === "scope-values" || message.type === "scope-reset") &&
            message.scope.kind === "attention";
        }
      }),
    ),
  );
  it.effect("the real hub closes 4403 only when all demanded scopes are source-refused", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.refuseSource();
        const incoming = yield* Queue.unbounded<readonly [Uint8Array]>();
        const outgoing = yield* Queue.unbounded<string | Socket.CloseEvent>();
        const socket = Socket.make({
          reader: Effect.succeed({ pull: Queue.take(incoming), upgrade: () => Effect.void }),
          writer: Effect.succeed({
            write: (frame) =>
              Queue.offer(outgoing, Socket.isCloseEvent(frame) ? frame : String(frame)).pipe(
                Effect.asVoid,
              ),
            writeAll: () => Effect.void,
          }),
        });
        const serving = yield* Effect.forkScoped(
          serveHqSocket(socket, "owner", Effect.succeed(undefined), {}).pipe(
            Effect.provideService(HqScopes, f.hub),
            Effect.provide(liveSocketsLayer),
          ),
        );
        yield* Queue.offer(incoming, [
          new TextEncoder().encode(
            '{"type":"subscribe","scopes":[{"scope":{"kind":"navigation"}},{"scope":{"kind":"attention","projectId":"P"}}]}',
          ),
        ]);
        assert.deepStrictEqual(yield* Fiber.join(serving), { by: "hq", code: 4403 });
        const writes = yield* Queue.takeAll(outgoing);
        assert.strictEqual(writes.filter(Socket.isCloseEvent).length, 1);
        assert.strictEqual(
          writes.filter((frame) => typeof frame === "string" && frame.includes("scope-error"))
            .length,
          2,
        );
      }),
    ),
  );
  it.effect("status ticks do not re-read roles or rebuild person navigation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        yield* client.take;
        const reads = f.roleReads();
        yield* Ref.set(f.checked, true);
        yield* Ref.set(f.official, { official: "unknown" as const, allowed: true });
        yield* TestClock.adjust("30 seconds");
        const changed = resetOf(yield* client.take);
        assert.deepStrictEqual(
          changed.values.map((value) => value.key),
          ["status"],
        );
        assert.strictEqual(f.roleReads(), reads);
      }),
    ),
  );
  it.effect("an invisible and a nonexistent requested app have the same refusal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("reader");
        yield* client.subscribe([{ scope: { kind: "app-detail", appId: "A" } }]);
        const first = yield* client.take;
        yield* client.subscribe([{ scope: { kind: "app-detail", appId: "unknown" } }]);
        const second = yield* client.take;
        assert.strictEqual(first.type, "scope-error");
        assert.strictEqual(second.type, "scope-error");
        if (first.type === "scope-error" && second.type === "scope-error")
          assert.deepStrictEqual([first.code, first.reason], [second.code, second.reason]);
      }),
    ),
  );
  it.effect("a recheck source refusal ends the attempt without automatic rechecks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const client = yield* f.connect("owner");
        yield* client.subscribe([{ scope: nav }]);
        yield* client.take;
        yield* client.take;
        f.refuseRecheck();
        yield* TestClock.adjust("30 seconds");
        assert.deepStrictEqual(yield* client.take, {
          type: "scope-error",
          scope: nav,
          code: "zerops_refused",
          reason: "forbidden",
          disposition: "refused",
        });
        assert.strictEqual(f.recheckReads(), 1);
        yield* TestClock.adjust("60 seconds");
        assert.strictEqual(f.recheckReads(), 1);
      }),
    ),
  );
  it.effect("a Zerops refusal retains facts and reconnect does not retry the source", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const first = yield* f.connect("owner");
        yield* first.subscribe([{ scope: nav }]);
        const before = resetOf(yield* first.take);
        yield* first.take;
        f.refuseSource();
        yield* first.subscribe([
          { scope: nav, cursor: before, knownKeys: before.values.map((value) => value.key) },
        ]);
        const failure = yield* first.take;
        assert.deepStrictEqual(failure, {
          type: "scope-error",
          scope: nav,
          code: "zerops_refused",
          reason: "forbidden",
          disposition: "refused",
        });
        const reads = f.roleReads();
        const next = yield* f.connect("owner");
        yield* next.subscribe([
          { scope: nav, cursor: before, knownKeys: before.values.map((value) => value.key) },
        ]);
        assert.deepStrictEqual(yield* next.take, failure);
        assert.strictEqual(f.roleReads(), reads);
      }),
    ),
  );
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
          source: { environmentId: "env", epoch: 1, incarnation: "boot", revision: 1 },
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
        assert.deepInclude(
          (first.values.find((value) => value.key === "project:P")!.value as { person: unknown })
            .person,
          { role: "OWNER", mayWrite: true, mine: true, unseen: 1 },
        );
        assert.deepInclude(
          (other.values.find((value) => value.key === "project:P")!.value as { person: unknown })
            .person,
          { role: "BASIC_USER", mayWrite: true, mine: false, unseen: 1 },
        );
        yield* owner.request({ type: "seen", projectId: "P", resultIds: ["result", "invented"] });
        assert.include(json(resetOf(yield* owner.take).values), '"unseen":0');
        yield* signer.subscribe([{ scope: nav, cursor: other }]);
        assert.strictEqual((yield* signer.take).type, "scope-ready");
      }),
    ),
  );
});
