import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
});
