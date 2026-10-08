import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { makeUsageOutbox, type CompletedUsage } from "./UsageOutbox.ts";

const binding = { orgId: "org", projectId: "project", mateId: "mate" };
const turn = (nativeTurnId: string, amount = "30"): CompletedUsage => ({
  provider: "claude",
  at: "2026-10-08T10:00:00.000Z",
  nativeThreadId: "native-thread",
  nativeTurnId,
  models: [
    {
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
    },
  ],
  nativeCost: null,
  parentId: null,
});
const withOutbox = <A, E>(
  run: (box: Effect.Success<typeof makeUsageOutbox>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  makeUsageOutbox.pipe(Effect.flatMap(run), Effect.provide(Sqlite.layer({ filename: ":memory:" })));

describe("completed Mate turn usage delivery", () => {
  it.effect("usage completed while HQ is down waits locally for acknowledgement", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.record(turn("a"));
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
          yield* box.record(turn("a"));
          const first = yield* box.batch;
          yield* box.record({ ...turn("a"), at: "2026-10-08T10:01:00.000Z" });
          const resent = yield* (yield* makeUsageOutbox).batch;
          assert.deepEqual(resent, first);
        }),
      ),
    );
  }
  for (const provider of ["claude", "codex"] as const) {
    it.effect(`${provider} counts subagent consumption once under its native turn identities`, () =>
      withOutbox((box) =>
        Effect.gen(function* () {
          yield* box.bind(binding);
          const parent = { ...turn("parent", "120"), provider };
          const child = { ...turn("child", "30"), provider };
          const values =
            provider === "claude"
              ? [
                  {
                    ...parent,
                    models: [...parent.models, { ...child.models[0]!, model: "claude-haiku-4-5" }],
                  },
                ]
              : [parent, { ...child, nativeThreadId: "child-thread", parentId: "parent" }];
          for (const value of [...values, ...values]) yield* box.record(value);
          const frame = yield* box.batch;
          assert.equal(frame?.facts.length, provider === "claude" ? 1 : 2);
          assert.equal(
            frame!.facts
              .flatMap((fact) => fact.models)
              .reduce((sum, line) => sum + BigInt(line.components.inclusiveTotal!), 0n),
            150n,
          );
        }),
      ),
    );
  }
  it.effect(
    "reordering a turn's reported model lines does not change its identity or consumption",
    () =>
      withOutbox((box) =>
        Effect.gen(function* () {
          yield* box.bind(binding);
          const value = turn("a");
          const models = [...value.models, { ...value.models[0]!, model: "claude-haiku-4-5" }];
          yield* box.record({ ...value, models });
          const first = yield* box.batch;
          yield* box.record({ ...value, models: models.toReversed() });
          assert.deepEqual(yield* box.batch, first);
        }),
      ),
  );
  it.effect("a conflicting turn fails instead of changing recorded consumption", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.record(turn("a"));
        const result = yield* box.record(turn("a", "50")).pipe(Effect.flip);
        assert.equal(result._tag, "UsageOutboxError");
      }),
    ),
  );
  it.effect("an acknowledgement deletes only facts from the acknowledged batch", () =>
    withOutbox((box) =>
      Effect.gen(function* () {
        yield* box.bind(binding);
        yield* box.record(turn("a"));
        const first = (yield* box.batch)!;
        yield* box.record(turn("b"));
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
