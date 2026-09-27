import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import * as CrewStore from "./CrewStore.ts";

const storeLayer = CrewStore.layer.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(runMigrations()).pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  ),
);

const lane = (overrides: Partial<CrewStore.CrewLaneRow> = {}): CrewStore.CrewLaneRow => ({
  crew: "game",
  lane: "backend",
  host: "appdev",
  branch: "crew/backend",
  dispatchCommit: "a".repeat(40),
  recordedTip: "a".repeat(40),
  lastLanding: null,
  refSnapshot: null,
  lockfileHash: null,
  frozenSince: null,
  state: "ready",
  ...overrides,
});

describe("CrewStore", () => {
  it.layer(storeLayer)("lanes", (it) => {
    it.effect("round-trips a lane, updates it in place and lists it by host", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        yield* store.putLane(lane());
        yield* store.putLane(
          lane({ crew: "shop", lane: "web", host: "webdev", branch: "crew/web" }),
        );
        yield* store.updateLane("game", "backend", (row) => ({
          ...row,
          recordedTip: "b".repeat(40),
          refSnapshot: { "refs/heads/crew/web": "c".repeat(40) },
        }));
        const read = yield* store.getLane("game", "backend");
        const onAppdev = yield* store.lanesOnHost("appdev");
        yield* store.deleteLane("shop", "web");
        assert.deepStrictEqual(
          {
            read: Option.getOrUndefined(read),
            onAppdev: onAppdev.map((row) => `${row.crew}/${row.lane}`),
            afterDelete: Option.isNone(yield* store.getLane("shop", "web")),
          },
          {
            read: lane({
              recordedTip: "b".repeat(40),
              refSnapshot: { "refs/heads/crew/web": "c".repeat(40) },
            }),
            onAppdev: ["game/backend"],
            afterDelete: true,
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("definition", (it) => {
    it.effect("bumps seq once per change and never lowers what was flushed", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const definition: CrewStore.CrewDefinitionRow = {
          crew: "game",
          homeHost: "appdev",
          spec: { members: ["backend"] },
          briefHash: "hash-1",
          briefVersion: 1,
          appliedAt: "2026-09-27T10:00:00.000Z",
          appliedBy: "user-1",
          seq: 0,
          flushedSeq: 0,
          state: "applied",
        };
        yield* store.putDefinition(definition);
        const seqs = [yield* store.bumpSeq("game"), yield* store.bumpSeq("game")];
        yield* store.markFlushed("game", 2);
        yield* store.markFlushed("game", 1);
        assert.deepStrictEqual(
          { seqs, read: Option.getOrUndefined(yield* store.getDefinition("game")) },
          { seqs: [1, 2], read: { ...definition, seq: 2, flushedSeq: 2 } },
        );
      }),
    );
  });

  it.layer(storeLayer)("landings", (it) => {
    it.effect("lists a host's landings oldest first, and a crewmate's tasks by number", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const member = (handle: string, host: string): CrewStore.CrewMemberRow => ({
          crew: "game",
          handle,
          displayName: handle,
          kind: "writer",
          tint: null,
          host,
          lane: handle,
          readOnly: false,
          login: null,
          model: null,
          effort: null,
          jobVersion: 1,
          runCommand: null,
          restartAfterMerge: false,
          crewPort: null,
          config: {},
        });
        const task = (
          assignment: string,
          number: number,
          owner: string,
          landedCommit: string | null,
        ): CrewStore.CrewAssignmentRow => ({
          assignment,
          run: null,
          crew: "game",
          member: owner,
          number,
          title: `Task ${number}`,
          source: "you",
          createdBy: "user-1",
          card: null,
          pending: null,
          dependsOn: [],
          fresh: false,
          state: landedCommit === null ? "queued" : "landed",
          attempt: 1,
          reworks: 0,
          remerges: 0,
          mergedHead: null,
          check: null,
          review: null,
          report: null,
          waiting: null,
          landedCommit,
          createdAt: "2026-09-27T10:00:00.000Z",
          updatedAt: `2026-09-27T10:0${number}:00.000Z`,
        });
        yield* store.putMember(member("backend", "appdev"));
        yield* store.putMember(member("web", "webdev"));
        yield* store.putAssignment(task("a-2", 2, "backend", "d".repeat(40)));
        yield* store.putAssignment(task("a-1", 1, "backend", "c".repeat(40)));
        yield* store.putAssignment(task("a-3", 3, "backend", null));
        yield* store.putAssignment(task("a-4", 4, "web", "e".repeat(40)));
        const read = yield* store.getAssignment("a-1");
        assert.deepStrictEqual(
          {
            landings: yield* store.landingsOnHost("appdev"),
            members: (yield* store.members("game")).map((row) => row.handle),
            backendTasks: yield* store.assignmentsOf("game", "backend"),
            read: Option.getOrUndefined(read),
          },
          {
            landings: [
              {
                crew: "game",
                member: "backend",
                assignment: "a-1",
                title: "Task 1",
                landedCommit: "c".repeat(40),
              },
              {
                crew: "game",
                member: "backend",
                assignment: "a-2",
                title: "Task 2",
                landedCommit: "d".repeat(40),
              },
            ],
            members: ["backend", "web"],
            backendTasks: ["a-1", "a-2", "a-3"],
            read: task("a-1", 1, "backend", "c".repeat(40)),
          },
        );
      }),
    );
  });

  it.layer(storeLayer)("hosts", (it) => {
    it.effect("round-trips a dev service's crew ports", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const host: CrewStore.CrewHostRow = {
          host: "appdev",
          crewPorts: [
            { port: 3001, routed: true },
            { port: 3002, routed: false },
          ],
        };
        yield* store.putHost(host);
        assert.deepStrictEqual(
          {
            known: Option.getOrUndefined(yield* store.getHost("appdev")),
            unknown: Option.isNone(yield* store.getHost("webdev")),
          },
          { known: host, unknown: true },
        );
      }),
    );
  });

  it.layer(storeLayer)("changes", (it) => {
    it.effect("publishes which table changed for which crew", () =>
      Effect.gen(function* () {
        const store = yield* CrewStore.CrewStore;
        const seen = yield* store.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* store.putLane(lane());
        yield* store.putHost({ host: "appdev", crewPorts: [] });
        assert.deepStrictEqual(Array.from(yield* Fiber.join(seen)), [
          { crew: "game", table: "lane" },
          { crew: null, table: "host" },
        ]);
      }),
    );
  });
});
