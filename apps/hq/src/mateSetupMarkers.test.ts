import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { makeMateSetupMarkers } from "./mateSetupMarkers.ts";
import { ZeropsRefused, ZeropsUnavailable } from "./zerops/api.ts";

describe("navigation setup marker evidence", () => {
  it.effect.each(
    Array.from([true, false, null] as const, (value) => ({
      title: `shares one read returning ${String(value)}, without blocking the baseline`,
      value,
    })),
  )("$title", ({ value }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const answer = yield* Deferred.make<boolean | null>();
        const published = yield* Queue.unbounded<void>();
        let reads = 0;
        const markers = yield* makeMateSetupMarkers(() => {
          reads += 1;
          return Deferred.await(answer);
        }, Queue.offer(published, undefined).pipe(Effect.asVoid));
        const input = {
          orgId: "ORG",
          projectId: "Ada",
          record: "1",
          serviceId: "zcp",
          importProcessId: null,
        };
        assert.strictEqual(yield* markers.read(input), null);
        assert.strictEqual(yield* markers.read(input), null);
        yield* Deferred.succeed(answer, value);
        yield* Queue.take(published);
        assert.strictEqual(yield* markers.read(input), value);
        assert.strictEqual(reads, 1);
      }),
    ),
  );
  it.effect.each(
    Array.from(
      [
        new ZeropsUnavailable({ operation: "marker", message: "outage" }),
        new ZeropsRefused({
          operation: "marker",
          reason: "forbidden",
          status: 403,
          code: "insufficientPermissions",
        }),
      ],
      (error) => ({
        title: `${error._tag} stays unknown; unchanged input never retries it`,
        error,
      }),
    ),
  )("$title", ({ error }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const published = yield* Queue.unbounded<void>();
        let reads = 0;
        const markers = yield* makeMateSetupMarkers(() => {
          reads += 1;
          return Effect.fail(error);
        }, Queue.offer(published, undefined).pipe(Effect.asVoid));
        const input = {
          orgId: "ORG",
          projectId: "Ada",
          record: "1",
          serviceId: "zcp",
          importProcessId: null,
        };
        yield* markers.read(input);
        yield* Queue.take(published);
        for (let i = 0; i < 3; i++) assert.strictEqual(yield* markers.read(input), null);
        assert.strictEqual(reads, 1);
        yield* markers.read({ ...input, importProcessId: "new-import" });
        yield* Queue.take(published);
        assert.strictEqual(reads, 2);
      }),
    ),
  );
  it.effect("fences an old read after a record is replaced", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const old = yield* Deferred.make<boolean | null>();
        const published = yield* Queue.unbounded<void>();
        const markers = yield* makeMateSetupMarkers(
          ({ record }) => (record === "old" ? Deferred.await(old) : Effect.succeed(true)),
          Queue.offer(published, undefined).pipe(Effect.asVoid),
        );
        const input = {
          orgId: "ORG",
          projectId: "Ada",
          record: "old",
          serviceId: "zcp",
          importProcessId: null,
        };
        yield* markers.read(input);
        yield* markers.read({ ...input, record: "new" });
        yield* Queue.take(published);
        yield* Deferred.succeed(old, false);
        assert.strictEqual(yield* markers.read({ ...input, record: "new" }), true);
      }),
    ),
  );
  it.effect("preserves usable marker evidence through a partial or unavailable refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const published = yield* Queue.unbounded<void>();
        const markers = yield* makeMateSetupMarkers(
          ({ importProcessId }) =>
            importProcessId === null ? Effect.succeed(true) : Effect.succeed(null),
          Queue.offer(published, undefined).pipe(Effect.asVoid),
        );
        const input = {
          orgId: "ORG",
          projectId: "Ada",
          record: "1",
          serviceId: "zcp",
          importProcessId: null,
        };
        yield* markers.read(input);
        yield* Queue.take(published);
        assert.strictEqual(yield* markers.read({ ...input, importProcessId: "new-import" }), true);
        yield* Queue.take(published);
        assert.strictEqual(yield* markers.read({ ...input, importProcessId: "new-import" }), true);
        markers.retain(new Set());
        assert.strictEqual(
          yield* markers.read({ ...input, record: "replacement", importProcessId: "new-import" }),
          null,
        );
      }),
    ),
  );
});
