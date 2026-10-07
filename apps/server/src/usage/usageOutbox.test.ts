import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { makeUsageOutbox, type CompletedUsage } from "./UsageOutbox.ts";

const binding = { orgId: "org", projectId: "project", mateId: "mate" };
const response = (nativeResponseId: string, amount = "30"): CompletedUsage => ({
  provider: "claude",
  at: "2026-10-08T10:00:00.000Z",
  nativeThreadId: "native-thread",
  nativeResponseId,
  model: "claude-sonnet-4-6",
  components: {
    uncachedInput: amount,
    cachedInput: "0",
    cacheCreation: "0",
    output: "0",
    reasoning: null,
    inclusiveTotal: amount,
  },
  nativeCost: null,
  parentId: null,
});
const withOutbox = <A, E>(
  run: (box: Effect.Success<typeof makeUsageOutbox>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  makeUsageOutbox.pipe(Effect.flatMap(run), Effect.provide(Sqlite.layer({ filename: ":memory:" })));

describe("completed Mate usage delivery", () => {
  it.effect("usage completed while HQ is down waits locally for acknowledgement", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.record(response("a"));
        assert.isUndefined(yield* box.batch);
        yield* box.bind(binding);
        const first = yield* box.batch;
        assert.equal(first?.facts.length, 1);
        const restarted = yield* makeUsageOutbox;
        assert.deepEqual(yield* restarted.batch, first);
        yield* restarted.acknowledge(first!, [
          { originId: first!.facts[0]!.originId, factId: first!.facts[0]!.factId },
        ]);
        assert.isUndefined(yield* restarted.batch);
      }),
    ),
  );
  for (const scenario of ["retry", "clone resend", "lost acknowledgement"] as const) {
    it.effect(`${scenario} keeps the same consumption identity`, () =>
      withOutbox((box) =>
        Effect.gen(function* () {
          yield* box.bind(binding);
          yield* box.record(response("a"));
          const first = yield* box.batch;
          yield* box.record({ ...response("a"), at: "2026-10-08T10:01:00.000Z" });
          const resent = yield* (yield* makeUsageOutbox).batch;
          assert.deepEqual(resent, first);
        }),
      ),
    );
  }
  it.effect("each child response is counted once without a parent cumulative total", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.bind(binding);
        for (const value of [
          response("parent", "120"),
          { ...response("child", "30"), nativeThreadId: "child-thread", parentId: "parent" },
          response("parent", "120"),
        ])
          yield* box.record(value);
        const frame = yield* box.batch;
        assert.equal(frame?.facts.length, 2);
        assert.equal(
          frame!.facts.reduce((sum, fact) => sum + BigInt(fact.components.inclusiveTotal!), 0n),
          150n,
        );
      }),
    ),
  );
  it.effect("a conflicting response fails instead of changing recorded consumption", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.record(response("a"));
        const result = yield* box.record(response("a", "50")).pipe(Effect.flip);
        assert.equal(result._tag, "UsageOutboxError");
      }),
    ),
  );
  it.effect("an acknowledgement deletes only facts from the acknowledged batch", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.bind(binding);
        yield* box.record(response("a"));
        const first = (yield* box.batch)!;
        yield* box.record(response("b"));
        yield* box.acknowledge(
          { ...first, batchId: "unrelated" },
          first.facts.map(({ originId, factId }) => ({ originId, factId })),
        );
        assert.equal((yield* box.batch)?.facts.length, 2);
        yield* box.acknowledge(
          first,
          first.facts.map(({ originId, factId }) => ({ originId, factId })),
        );
        const next = yield* box.batch;
        assert.equal(next?.facts.length, 1);
        assert.equal(next?.facts[0]?.nativeId, "b");
      }),
    ),
  );
  it.effect("an upgraded Mate drops scanner tables and begins with no invented history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const table of [
        "usage_meta",
        "usage_origins",
        "usage_facts",
        "usage_checkpoints",
        "usage_journal",
        "usage_prefix",
        "usage_snapshot",
      ])
        yield* sql.unsafe(`CREATE TABLE ${table} (value TEXT)`);
      yield* sql`INSERT INTO usage_facts VALUES ('old guessed total')`;
      const box = yield* makeUsageOutbox;
      yield* box.bind(binding);
      assert.isUndefined(yield* box.batch);
      const tables = yield* sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type='table'`;
      assert.isFalse(
        tables.some((row) => row.name === "usage_checkpoints" || row.name === "usage_facts"),
      );
    }).pipe(Effect.provide(Sqlite.layer({ filename: ":memory:" }))),
  );
});
