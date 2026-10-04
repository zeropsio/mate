import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as Socket from "effect/unstable/socket/Socket";

import { mainAt, memoryStore, overviewOf } from "../test/harness/overviews.ts";

/** The Mate's link open, its whole overview sent. */
const linkedMate = (overviews: MateOverviews["Service"]) =>
  Effect.gen(function* () {
    const link = yield* overviews.connect("P_MATE");
    yield* overviews.report("P_MATE", link, {
      type: "overview",
      full: true,
      overview: overviewOf({
        logins: { codex: { signedInBy: "owner", present: true, token: false } },
      }),
    });
    return link;
  });
import type { AppReadValue } from "@t3tools/shared/hqAppReads";
import type { RecipeTier } from "@t3tools/shared/hqRecipe";

import { Backup, type BackupStatus } from "./backup.ts";
import { ChangeRefused, Changes } from "./changes.ts";
import { DeployKeys } from "./deployKeys.ts";
import { GitHost } from "./gitHost.ts";
import { Deploys } from "./deploys.ts";
import { MateOverviews, makeMateOverviews } from "./mateOverviews.ts";
import { Official, type OfficialStatus } from "./official.ts";
import { Releases } from "./releases.ts";
import { type OrgView, Roles } from "./roles.ts";
import { Structure, type StructureRead } from "./structure.ts";
import {
  MATES_BATCH,
  liveSocketsLayer,
  serveStructureSocket,
  structureMessages,
} from "./stream.ts";

/** The Core this one is, as its bundle stamps it (`vite.config.ts`). */
const BUILD = "20261004T100000Z.0123456789ab";
import type { ZeropsMember } from "./zerops/api.ts";

const member = (userId: string, roleCode: string): ZeropsMember => ({
  name: `Person ${userId}`,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
});

/** The org as HQ reads it: an owner, a reader, a Developer, and the Mate's project. */
const org = (userRoles: OrgView["projects"][number]["userRoles"] = []): OrgView<"cached"> => ({
  orgId: "ORG",
  freshness: "cached",
  members: [
    member("owner", "OWNER"),
    member("reader", "READ_ONLY"),
    member("dev", "NO_ACCESS"),
    { ...member("T-zcp", "ADMIN"), name: "zcp-key", kind: "token" },
  ],
  projects: [
    {
      id: "P_MATE",
      orgId: "ORG",
      name: "Ada's project",
      status: "ACTIVE",
      tags: [],
      userRoles,
      publicZone: "p.zone",
    },
  ],
});

/** One Mate in no application, made by the owner. */
const STRUCTURE: StructureRead = {
  ungrouped: [
    {
      projectId: "P_MATE",
      name: "Ada's project",
      mate: {
        name: "Ada's project",
        face: "face-1",
        madeBy: "owner",
        standupRequestedBy: "dev",
        closedOff: false,
        keyWider: false,
      },
    },
  ],
  apps: [],
};

/**
 * `userId`'s structure stream over a structure that changes when `version` moves, with the
 * structure reads counted; what it sends, as it sends it.
 */
const streamFor = (
  userId: string,
  before: (
    overviews: MateOverviews["Service"],
  ) => Effect.Effect<unknown, never, Scope.Scope> = () => Effect.void,
  /** The applications whose changes `userId` reads, by id. */
  readable: Readonly<Record<string, ReadonlyArray<never>>> = {},
  /** Where this Core's check of Zerops stands as the stream opens. */
  start: { readonly official: OfficialStatus["official"]; readonly checked: boolean } = {
    official: "ok",
    checked: true,
  },
) =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const version = yield* SubscriptionRef.make(0);
    /** Where each application's releases and repositories last moved, by id. */
    const revisions = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
    /** Ticks after a release is recorded. */
    const released = yield* SubscriptionRef.make(0);
    const appReads = yield* Ref.make<ReadonlyMap<string, AppReadValue>>(
      new Map(
        Object.keys(readable).map((appId) => [
          appId,
          {
            releases: [],
            repos: [
              { name: "group", mainHead: "a".repeat(40), updatedAt: "2026-10-03T10:00:00.000Z" },
            ],
            recipes: {
              mate: { state: "absent" as const },
              stage: { state: "absent" as const },
              production: { state: "absent" as const },
            },
          },
        ]),
      ),
    );
    const appReadCalls: string[] = [];
    /** The applications whose Mate tier HQ cannot read: too large for its bound. */
    const mateUnreadable = new Set<string>();
    /** Whether this Core is the official HQ, as its last check of Zerops said. */
    const official = yield* Ref.make<OfficialStatus>({ official: start.official, allowed: true });
    /** This Core's newest backup set, as its health reports it. */
    const backup = yield* Ref.make<BackupStatus>({ state: "pending" });
    /** Whether this Core's first check of Zerops has finished. */
    const checked = yield* Ref.make(start.checked);
    const view = yield* Ref.make(org([{ clientUserId: "C-dev", roleCode: "BASIC_USER" }]));
    const overviews = yield* makeMateOverviews(memoryStore().store);
    yield* before(overviews);
    const services = Layer.mergeAll(
      Layer.succeed(
        Structure,
        Structure.of({
          read: () =>
            Effect.as(
              Ref.update(reads, (n) => n + 1),
              STRUCTURE,
            ),
          changes: SubscriptionRef.changes(version),
        } as unknown as Structure["Service"]),
      ),
      Layer.succeed(
        Changes,
        Changes.of({
          readable: () => Effect.succeed(readable),
          releaseRevisions: Ref.get(revisions),
          listRepos: (_userId: string, appId: string) =>
            Effect.gen(function* () {
              appReadCalls.push(`${appId}:repos`);
              return (yield* Ref.get(appReads)).get(appId)!.repos;
            }),
          readRecipe: (_userId: string, appId: string, tier: RecipeTier) =>
            Effect.gen(function* () {
              appReadCalls.push(`${appId}:${tier}`);
              if (tier === "mate" && mateUnreadable.has(appId)) {
                return yield* new ChangeRefused({ code: "too_large", reason: "recipe_too_large" });
              }
              return (yield* Ref.get(appReads)).get(appId)!.recipes[tier]!;
            }),
          changes: Stream.never,
        } as unknown as Changes["Service"]),
      ),
      Layer.succeed(
        Releases,
        Releases.of({
          changes: SubscriptionRef.changes(released),
          list: (_userId: string, appId: string) =>
            Effect.gen(function* () {
              appReadCalls.push(`${appId}:releases`);
              return (yield* Ref.get(appReads)).get(appId)!.releases;
            }),
        } as unknown as Releases["Service"]),
      ),
      Layer.succeed(
        Deploys,
        Deploys.of({ changes: Stream.never } as unknown as Deploys["Service"]),
      ),
      Layer.succeed(Roles, Roles.of({ view: Ref.get(view) } as unknown as Roles["Service"])),
      Layer.succeed(MateOverviews, overviews),
      Layer.succeed(
        GitHost,
        GitHost.of({
          status: Effect.succeed({ git: "open", quarantined: [] }),
        } as unknown as GitHost["Service"]),
      ),
      Layer.succeed(Backup, Backup.of({ status: Ref.get(backup) } as unknown as Backup["Service"])),
      Layer.succeed(
        DeployKeys,
        DeployKeys.of({
          state: "ok",
          status: Effect.succeed("ok"),
        } as unknown as DeployKeys["Service"]),
      ),
      Layer.succeed(
        Official,
        Official.of({
          status: Ref.get(official),
          checked: Ref.get(checked),
        } as unknown as Official["Service"]),
      ),
    );
    const sent: Array<{ readonly type: string } & Record<string, unknown>> = [];
    yield* Effect.forkScoped(
      Stream.runForEach(
        structureMessages(userId, Effect.succeed(undefined), Duration.hours(1), MATES_BATCH, BUILD),
        (message) => Effect.sync(() => sent.push(message as (typeof sent)[number])),
      ).pipe(Effect.provide(services), Effect.tapCause(Effect.logError)),
    );
    yield* Effect.repeat(Effect.yieldNow, { times: 50 });
    yield* TestClock.adjust("1 millis");
    return {
      sent,
      reads,
      version,
      view,
      overviews,
      revisions,
      released,
      appReads,
      appReadCalls,
      official,
      checked,
      mateUnreadable,
      backup,
    };
  });

describe("the structure stream", () => {
  it.effect("carries the five load reads for readable apps, and re-reads only the moved app", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner", undefined, { "app-shop": [], "app-team": [] });
        const shop = (yield* Ref.get(h.appReads)).get("app-shop")!;
        const team = (yield* Ref.get(h.appReads)).get("app-team")!;
        assert.deepStrictEqual(h.sent[0]?.["appReads"], {
          "app-shop": { revision: null, value: shop, failure: null },
          "app-team": { revision: null, value: team, failure: null },
        });
        assert.strictEqual(h.appReadCalls.length, 10);
        h.appReadCalls.length = 0;
        const fresh: AppReadValue = {
          releases: [
            {
              tag: "v0.1.0",
              sha: "b".repeat(40),
              entries: [{ service: "app", sha: "c".repeat(40) }],
              by: "owner",
              at: "2026-10-03T10:00:00.000Z",
              state: "approved",
              reason: null,
              rollbackOf: null,
            },
          ],
          repos: [
            { name: "group", mainHead: "b".repeat(40), updatedAt: "2026-10-03T10:00:00.000Z" },
          ],
          recipes: {
            mate: {
              state: "present",
              mainHead: "b".repeat(40),
              importYaml: "services:\n  - hostname: appdev\n",
            },
            stage: {
              state: "present",
              mainHead: "b".repeat(40),
              importYaml: "services:\n  - hostname: appstage\n",
            },
            production: {
              state: "present",
              mainHead: "b".repeat(40),
              importYaml: "services:\n  - hostname: app\n",
            },
          },
        };
        yield* Ref.update(h.appReads, (current) => new Map(current).set("app-shop", fresh));
        yield* Ref.set(
          h.revisions,
          new Map([
            ["app-shop", "3"],
            ["app-secret", "4"],
          ]),
        );
        yield* SubscriptionRef.update(h.released, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        assert.deepStrictEqual(h.sent.slice(1), [
          {
            type: "release-revision",
            appId: "app-shop",
            read: { revision: "3", value: fresh, failure: null },
          },
        ]);
        assert.deepStrictEqual(h.appReadCalls.toSorted(), [
          "app-shop:mate",
          "app-shop:production",
          "app-shop:releases",
          "app-shop:repos",
          "app-shop:stage",
        ]);
        h.appReadCalls.length = 0;
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        assert.deepStrictEqual(h.appReadCalls, []);
      }),
    ),
  );

  const verdict = (official: OfficialStatus["official"]): OfficialStatus => ({
    official,
    allowed: true,
  });
  // HQ serving while it cannot check Zerops is no outage, and the reader is told so (e840eb444).
  it.effect("carries whether HQ could check Zerops, and each time that changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner");
        assert.strictEqual(h.sent[0]?.["official"], "ok");
        yield* Ref.set(h.official, verdict("unknown"));
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        yield* Ref.set(h.official, verdict("ok"));
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        assert.deepStrictEqual(h.sent.slice(1), [
          { type: "official", official: "unknown" },
          { type: "official", official: "ok" },
        ]);
      }),
    ),
  );

  // What an owner's update offer weighs against the Core this app carries (`hq/update.ts`).
  it.effect("names the Core it is in its snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner");
        assert.strictEqual(h.sent[0]?.["build"], BUILD);
      }),
    ),
  );

  // HQ's card says how its parts stand, from the stream — never a /health poll.
  it.effect("says how its parts stand in its snapshot, and each time they change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner");
        assert.deepStrictEqual(h.sent[0]?.["parts"], {
          db: "up",
          backup: { state: "pending" },
          keys: "ok",
        });
        yield* Ref.set(h.backup, { state: "off" });
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        assert.deepStrictEqual(h.sent.slice(1), [
          { type: "parts", parts: { db: "up", backup: { state: "off" }, keys: "ok" } },
        ]);
      }),
    ),
  );

  // A Core starts at `unknown` until its first check answers: no verdict, never "can't check".
  it.effect("says no verdict before HQ's first check of Zerops, then the check's", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner", undefined, {}, { official: "unknown", checked: false });
        assert.strictEqual(h.sent[0]?.["official"], null);
        yield* Ref.set(h.checked, true);
        yield* Ref.set(h.official, verdict("ok"));
        yield* SubscriptionRef.update(h.version, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        assert.deepStrictEqual(h.sent.slice(1), [{ type: "official", official: "ok" }]);
      }),
    ),
  );

  // The releases, repositories, stage and production do not stand on a file they do not use.
  it.effect("a Mate tier it cannot read is left out, and fails nothing beside it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* streamFor("owner", undefined, { "app-shop": [] });
        h.mateUnreadable.add("app-shop");
        yield* Ref.set(h.revisions, new Map([["app-shop", "3"]]));
        yield* SubscriptionRef.update(h.released, (n) => n + 1);
        yield* Effect.repeat(Effect.yieldNow, { times: 50 });
        const { mate: _mate, ...recipes } = (yield* Ref.get(h.appReads)).get("app-shop")!.recipes;
        const value = (yield* Ref.get(h.appReads)).get("app-shop")!;
        assert.deepStrictEqual(h.sent.slice(1), [
          {
            type: "release-revision",
            appId: "app-shop",
            read: { revision: "3", value: { ...value, recipes }, failure: null },
          },
        ]);
      }),
    ),
  );

  it.effect("an overview report runs no structure read for any open stream", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sent, reads, overviews } = yield* streamFor("owner");
        assert.deepStrictEqual(
          sent.map((message) => message.type),
          ["snapshot"],
        );
        const readsAtSnapshot = yield* Ref.get(reads);
        const link = yield* overviews.connect("P_MATE");
        yield* overviews.report("P_MATE", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        yield* TestClock.adjust("500 millis");
        assert.deepStrictEqual(
          sent.slice(1).map((message) => [message.type, message["projectId"]]),
          [["mate", "P_MATE"]],
        );
        assert.strictEqual(yield* Ref.get(reads), readsAtSnapshot);
      }),
    ),
  );

  it.effect(
    "sends each observable Mate's view in the snapshot and none to a read-only reader",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* streamFor("owner", linkedMate);
          const snapshot = owner.sent[0] as unknown as {
            readonly mates: Record<string, Record<string, unknown>>;
            readonly people: unknown;
          };
          assert.deepStrictEqual(Object.keys(snapshot.mates), ["P_MATE"]);
          assert.deepStrictEqual(snapshot.mates["P_MATE"]?.["presence"], {
            online: true,
            since: "1970-01-01T00:00:00.000Z",
            overview: "live",
          });
          assert.deepStrictEqual(
            snapshot.mates["P_MATE"]?.["logins"],
            overviewOf({ logins: { codex: { signedInBy: "owner", present: true, token: false } } })
              .logins,
          );

          // A reader sees the Mate listed, and nothing of what it does — then or later.
          const reader = yield* streamFor("reader", linkedMate);
          const read = reader.sent[0] as unknown as typeof snapshot;
          assert.deepStrictEqual(read.mates, {});
          const link = yield* reader.overviews.connect("P_MATE");
          yield* reader.overviews.report("P_MATE", link, {
            type: "overview",
            full: true,
            overview: overviewOf(),
          });
          yield* TestClock.adjust("1 second");
          assert.deepStrictEqual(
            reader.sent.map((message) => message.type),
            ["snapshot"],
          );
        }),
      ),
  );

  it.effect("sends only changed sections, at most once per 500 ms", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let link = 0;
        const { sent, overviews } = yield* streamFor("owner", (mates) =>
          Effect.map(linkedMate(mates), (opened) => {
            link = opened;
          }),
        );
        const mateMessages = () => sent.filter((message) => message.type === "mate");
        // A busy Mate: a step every 100 ms.
        for (const step of ["Read the schema", "Write the migration", "Run the tests"]) {
          yield* overviews.report("P_MATE", link, {
            type: "overview",
            full: false,
            sections: { main: mainAt(step) },
          });
          yield* TestClock.adjust("100 millis");
        }
        assert.deepStrictEqual(mateMessages(), []);
        yield* TestClock.adjust("200 millis");
        assert.deepStrictEqual(mateMessages(), [
          { type: "mate", projectId: "P_MATE", value: { main: mainAt("Run the tests") } },
        ]);
        // The same section again says nothing.
        yield* overviews.report("P_MATE", link, {
          type: "overview",
          full: false,
          sections: { main: mainAt("Run the tests") },
        });
        yield* TestClock.adjust("1 second");
        assert.strictEqual(mateMessages().length, 1);
      }),
    ),
  );

  it.effect("sends a Mate as null once the reader's role drops below Basic user", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sent, version, view } = yield* streamFor("dev", linkedMate);
        const snapshot = sent[0] as unknown as { readonly mates: Record<string, unknown> };
        assert.deepStrictEqual(Object.keys(snapshot.mates), ["P_MATE"]);
        // Lowered to Read only on the Mate's project: listed, and no longer observed.
        yield* Ref.set(view, org([{ clientUserId: "C-dev", roleCode: "READ_ONLY" }]));
        yield* SubscriptionRef.update(version, (tick) => tick + 1);
        yield* TestClock.adjust("1 millis");
        assert.deepStrictEqual(
          sent.filter((message) => message.type === "mate"),
          [{ type: "mate", projectId: "P_MATE", value: null }],
        );
      }),
    ),
  );

  it.effect(
    "names whoever an OWNER entry names on the reader's projects, by member id, no token",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sent, version, view } = yield* streamFor("owner");
          // Handed over to the reader (F23): the project's OWNER entry names them by member id.
          yield* Ref.set(
            view,
            org([
              { clientUserId: "C-dev", roleCode: "BASIC_USER" },
              { clientUserId: "C-reader", roleCode: "OWNER" },
              { clientUserId: "C-T-zcp", roleCode: "OWNER" },
            ]),
          );
          yield* SubscriptionRef.update(version, (tick) => tick + 1);
          yield* TestClock.adjust("1 millis");
          assert.deepStrictEqual(
            sent.filter((message) => message.type === "people"),
            [
              {
                type: "people",
                people: {
                  owner: { name: "Person owner", clientUserId: "C-owner" },
                  dev: { name: "Person dev", clientUserId: "C-dev" },
                  reader: { name: "Person reader", clientUserId: "C-reader" },
                },
              },
            ],
          );
        }),
      ),
  );

  it.effect("names the people the view names and no token", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const signers = {
          codex: { signedInBy: "owner", present: true, token: false },
          "claude-code": { signedInBy: "T-zcp", present: true, token: true },
          gemini: { signedInBy: "a-stranger", present: false, token: false },
        };
        const opened = (mates: MateOverviews["Service"]) =>
          Effect.gen(function* () {
            const link = yield* mates.connect("P_MATE");
            yield* mates.report("P_MATE", link, {
              type: "overview",
              full: true,
              overview: overviewOf({ logins: signers }),
            });
          });
        const peopleOf = (sent: ReadonlyArray<{ readonly type: string }>) =>
          (sent[0] as unknown as { readonly people: unknown }).people;
        // Its maker and its stand-up's asker from its record; its signers from its overview.
        assert.deepStrictEqual(peopleOf((yield* streamFor("owner", opened)).sent), {
          owner: { name: "Person owner", clientUserId: "C-owner" },
          dev: { name: "Person dev", clientUserId: "C-dev" },
        });
        // A reader is named only what the record says.
        assert.deepStrictEqual(peopleOf((yield* streamFor("reader", opened)).sent), {
          owner: { name: "Person owner", clientUserId: "C-owner" },
          dev: { name: "Person dev", clientUserId: "C-dev" },
        });
        // A signer who appears later is named when the overview names them.
        const { sent, overviews } = yield* streamFor("owner");
        assert.deepStrictEqual(peopleOf(sent), {
          owner: { name: "Person owner", clientUserId: "C-owner" },
          dev: { name: "Person dev", clientUserId: "C-dev" },
        });
        const link = yield* overviews.connect("P_MATE");
        yield* overviews.report("P_MATE", link, {
          type: "overview",
          full: true,
          overview: overviewOf({
            logins: { codex: { signedInBy: "reader", present: true, token: false } },
          }),
        });
        yield* TestClock.adjust("500 millis");
        assert.deepStrictEqual(
          sent.filter((message) => message.type === "people"),
          [
            {
              type: "people",
              people: {
                owner: { name: "Person owner", clientUserId: "C-owner" },
                dev: { name: "Person dev", clientUserId: "C-dev" },
                reader: { name: "Person reader", clientUserId: "C-reader" },
              },
            },
          ],
        );
      }),
    ),
  );
});

// F26: the live HQ's structure sockets ended every 120 s with no word of who ended them.
describe("serveStructureSocket: who ended a socket, and with what code", () => {
  /** A socket whose client stays until `closeBy` closes it with a code; it answers every ping. */
  const clientSocket = Effect.gen(function* () {
    const closing = yield* Deferred.make<number>();
    const socket = Socket.make({
      reader: Effect.succeed({
        pull: Effect.flatMap(Deferred.await(closing), (code) =>
          Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code }) })),
        ),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
    });
    return { socket, closeBy: (code: number) => Deferred.succeed(closing, code) };
  });

  it.effect("ends a healthy segment cleanly at 100 seconds, even with pongs", () =>
    Effect.gen(function* () {
      const incoming = yield* Queue.unbounded<readonly [Uint8Array]>();
      const closes: Array<{ code: number; reason: string }> = [];
      const socket = Socket.make({
        reader: Effect.succeed({ pull: Queue.take(incoming), upgrade: () => Effect.void }),
        writer: Effect.succeed({
          write: (frame) =>
            Effect.gen(function* () {
              if (Socket.isCloseEvent(frame))
                closes.push({ code: frame.code, reason: frame.reason ?? "" });
              else yield* Queue.offer(incoming, [new TextEncoder().encode('{"type":"pong"}')]);
            }),
          writeAll: () => Effect.void,
        }),
      });
      const serving = yield* Effect.forkChild(
        serveStructureSocket(socket, Stream.never, Duration.seconds(20)),
      );
      yield* TestClock.adjust("99999 millis");
      assert.deepStrictEqual(closes, []);
      yield* TestClock.adjust("1 millis");
      assert.deepStrictEqual(closes, [{ code: 4410, reason: "segment over" }]);
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "hq", code: 4410 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );

  it.effect("the client, with the code its close carried", () =>
    Effect.gen(function* () {
      const { socket, closeBy } = yield* clientSocket;
      const serving = yield* Effect.forkChild(
        serveStructureSocket(socket, Stream.never, Duration.seconds(20)),
      );
      yield* closeBy(1006);
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "client", code: 1006 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );

  it.effect("HQ, with the code it closed with", () =>
    Effect.gen(function* () {
      const { socket } = yield* clientSocket;
      const ended = yield* serveStructureSocket(
        socket,
        Stream.make({ type: "end", ending: "session" } as const),
        Duration.seconds(20),
      );
      assert.deepStrictEqual(ended, { by: "hq", code: 4401 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );
});

it.effect("the people stream names a signed-out Mate's last signer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { sent } = yield* streamFor("owner", (mates) =>
        Effect.gen(function* () {
          const link = yield* mates.connect("P_MATE");
          yield* mates.report("P_MATE", link, {
            type: "overview",
            full: true,
            overview: overviewOf({
              logins: {
                codex: { signedInBy: null, lastSignedInBy: "reader", present: false, token: false },
              },
            }),
          });
        }),
      );
      const snapshot = sent[0] as unknown as {
        readonly people: Readonly<
          Record<string, { readonly name: string; readonly clientUserId?: string }>
        >;
      };
      assert.deepStrictEqual(snapshot.people.reader, {
        name: "Person reader",
        clientUserId: "C-reader",
      });
    }),
  ),
);
