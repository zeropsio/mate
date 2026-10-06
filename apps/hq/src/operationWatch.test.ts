import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { makeOperationWatch, type OperationWire, type Registration } from "./operationWatch.ts";
import { ZeropsRefused, ZeropsUnavailable } from "./zerops/api.ts";

const decodeSearch = Schema.decodeUnknownEffect(
  Schema.Struct({ search: Schema.Array(Schema.Struct({ name: Schema.String })) }),
);
const target = { projectId: "P", processIds: ["J"], versionId: null };
const row = (status: string, version = 1) => ({ id: "J", status, _version: version });
const frames = (updates: ReadonlyArray<unknown>) =>
  Stream.fromIterable(
    updates.map((update) =>
      JSON.stringify({ type: "Message", subscriptionName: "updates", data: { update: [update] } }),
    ),
  );
const wireOf = (options: {
  readonly baseline?: ReadonlyArray<unknown>;
  readonly updates?: ReadonlyArray<unknown>;
  readonly missing?: unknown;
  readonly calls: Array<{ path: string; body?: unknown }>;
}): OperationWire => ({
  open: Effect.succeed({
    receiverId: "R",
    frames: frames(options.updates ?? []),
    post: (path, body) => {
      options.calls.push({ path, body });
      return Effect.succeed(
        body.wsOutputType === "listStream"
          ? { items: options.baseline ?? [], totalHits: (options.baseline ?? []).length }
          : { success: true },
      );
    },
    get: (path) => {
      options.calls.push({ path });
      return Effect.succeed(
        path === "/project/P" ? { clientId: "ORG" } : (options.missing ?? row("FINISHED", 2)),
      );
    },
  }),
  makeId: () => "updates",
});

const collect = (wire: OperationWire) =>
  makeOperationWatch(wire)
    .watch(target)
    .pipe(
      Stream.takeUntil((signal) =>
        signal.processes.some((process) => process.status === "FINISHED"),
      ),
      Stream.runCollect,
      Effect.scoped,
    );

describe("HQ operation observation", () => {
  it.live.each([401, 403, 404])("does not retry a project's definitive %s refusal", (status) =>
    Effect.gen(function* () {
      let reads = 0;
      const watch = makeOperationWatch({
        makeId: () => "registration",
        open: Effect.succeed({
          receiverId: "R",
          frames: Stream.never,
          post: () => Effect.die("a refused project must not register"),
          get: (path) => {
            assert.strictEqual(path, "/project/P");
            reads++;
            return Effect.fail(
              new ZeropsRefused({
                operation: path,
                status,
                code: "project_observation_refused",
                reason:
                  status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "not_found",
              }),
            );
          },
        }),
      });
      const error = yield* watch.watch(target).pipe(Stream.runDrain, Effect.flip, Effect.scoped);
      assert.strictEqual(error._tag, "ZeropsRefused");
      assert.strictEqual(reads, 1);
    }),
  );

  it.live.each(["FINISHED", "FAILED", "CANCELED"] as const)(
    "scopes every registration to the project's organization and reads the original %s handle",
    (status) =>
      Effect.gen(function* () {
        const calls: Array<{ path: string; body?: Registration }> = [];
        let sequence = 0;
        const watch = makeOperationWatch({
          makeId: () => `registration-${sequence++}`,
          open: Effect.succeed({
            receiverId: "R",
            frames: Stream.never,
            post: (path, body) => {
              calls.push({ path, body });
              return Effect.succeed(
                body.wsOutputType === "listStream"
                  ? {
                      items:
                        path === "/app-version/search" ? [{ id: "V", status: "BUILDING" }] : [],
                    }
                  : { success: true },
              );
            },
            get: (path) => {
              calls.push({ path });
              return Effect.succeed(path === "/project/P" ? { clientId: "ORG" } : { status });
            },
          }),
        });
        const signals = yield* watch.watch({ ...target, versionId: "V" }).pipe(
          Stream.takeUntil((signal) => signal.processes.some((p) => p.status === status)),
          Stream.runCollect,
          Effect.scoped,
        );
        assert.strictEqual(signals.at(-1)?.processes[0]?.status, status);
        assert.deepStrictEqual(calls[0], { path: "/project/P" });
        for (const call of calls.filter((call) => call.body !== undefined)) {
          assert.includeDeepMembers(
            [...call.body!.search],
            [
              { name: "clientId", operator: "eq", value: "ORG" },
              { name: "projectId", operator: "eq", value: "P" },
            ],
          );
        }
        assert.lengthOf(
          calls.filter((call) => call.body !== undefined),
          4,
        );
      }),
  );

  it.live(
    "discovers only the accepted version's process when it appears after an UPLOADING baseline",
    () =>
      Effect.gen(function* () {
        let sequence = 0;
        let updates = "";
        const watch = makeOperationWatch({
          makeId: () => `registration-${sequence++}`,
          open: Effect.succeed({
            receiverId: "R",
            post: (path, body) => {
              if (path === "/process/search" && body.wsOutputType === "updateStream")
                updates = body.subscriptionName;
              return Effect.succeed(
                body.wsOutputType === "listStream"
                  ? {
                      items:
                        path === "/app-version/search" ? [{ id: "V", status: "UPLOADING" }] : [],
                    }
                  : { success: true },
              );
            },
            get: (path) =>
              path === "/project/P"
                ? Effect.succeed({ clientId: "ORG" })
                : Effect.die("no original handle to read"),
            frames: Stream.unwrap(
              Effect.sync(() =>
                Stream.fromIterable(
                  [
                    { id: "other", status: "FINISHED", appVersion: { id: "other-version" } },
                    { id: "accepted", status: "RUNNING", appVersion: { id: "V" } },
                    { id: "accepted", status: "FINISHED", appVersion: { id: "V" } },
                  ].map((row) =>
                    JSON.stringify({ subscriptionName: updates, data: { update: [row] } }),
                  ),
                ),
              ),
            ),
          }),
        });
        const signals = yield* watch.watch({ projectId: "P", processIds: [], versionId: "V" }).pipe(
          Stream.takeUntil((signal) => signal.processes.some((p) => p.status === "FINISHED")),
          Stream.runCollect,
          Effect.scoped,
          Effect.timeout(500),
        );
        assert.strictEqual(signals.at(-1)?.processes[0]?.id, "accepted");
        assert.isFalse(signals.some((signal) => signal.processes.some((p) => p.id === "other")));
      }),
  );

  it.live("reads a newly discovered process by id after it finishes during a socket gap", () =>
    Effect.gen(function* () {
      let opens = 0;
      let sequence = 0;
      const reads: Array<string> = [];
      const watch = makeOperationWatch({
        makeId: () => `registration-${sequence++}`,
        open: Effect.sync(() => {
          const first = ++opens === 1;
          return {
            receiverId: "R",
            post: (path, body) =>
              Effect.succeed(
                body.wsOutputType === "listStream"
                  ? {
                      items:
                        path === "/app-version/search"
                          ? [{ id: "V", status: "BUILDING" }]
                          : first
                            ? [{ id: "accepted", status: "RUNNING", appVersion: { id: "V" } }]
                            : [],
                    }
                  : { success: true },
              ),
            get: (path) => {
              if (path === "/project/P") return Effect.succeed({ clientId: "ORG" });
              reads.push(path);
              return Effect.succeed({ status: "FINISHED" });
            },
            frames: Stream.fail(new ZeropsUnavailable({ operation: "socket", message: "gap" })),
          };
        }),
      });
      const signals = yield* watch.watch({ projectId: "P", processIds: [], versionId: "V" }).pipe(
        Stream.takeUntil((signal) => signal.processes.some((p) => p.status === "FINISHED")),
        Stream.runCollect,
        Effect.scoped,
        Effect.timeout(1_000),
      );
      assert.deepStrictEqual(reads, ["/process/accepted"]);
      assert.strictEqual(signals.at(-1)?.processes[0]?.appVersion?.id, "V");
    }),
  );

  it.live(
    "registers unfiltered updates before taking the running baseline and accepts a terminal push",
    () =>
      Effect.gen(function* () {
        const calls: Array<{ path: string; body?: unknown }> = [];
        const signals = yield* collect(
          wireOf({ calls, baseline: [row("RUNNING")], updates: [row("FINISHED", 2)] }),
        );
        assert.deepStrictEqual(
          signals.at(-1)?.processes.map((process) => process.status),
          ["FINISHED"],
        );
        const bodies = calls.flatMap((call) => (call.body === undefined ? [] : [call.body]));
        const body = yield* decodeSearch(bodies[0]);
        assert.isFalse(body.search.some((filter) => filter.name === "status"));
        assert.lengthOf(
          calls.filter((call) => call.path === "/process/J"),
          0,
        );
      }),
  );
  it.live(
    "reads a tracked process by id when it finished during a gap and is absent from the baseline",
    () =>
      Effect.gen(function* () {
        const calls: Array<{ path: string; body?: unknown }> = [];
        const signals = yield* collect(wireOf({ calls }));
        assert.strictEqual(signals.at(-1)?.processes[0]?.status, "FINISHED");
        assert.deepStrictEqual(
          calls.filter((call) => call.body === undefined),
          [{ path: "/project/P" }, { path: "/process/J" }],
        );
      }),
  );
  it.live("re-registers after transport loss without deleting facts", () =>
    Effect.gen(function* () {
      const calls: Array<{ path: string; body?: unknown }> = [];
      let opens = 0;
      const first = wireOf({ calls, baseline: [row("RUNNING")] });
      const second = wireOf({ calls });
      const wire: OperationWire = {
        makeId: () => "updates",
        open: Effect.suspend(() =>
          ++opens === 1
            ? Effect.map(first.open, (link) => ({
                ...link,
                frames: Stream.fail(new ZeropsUnavailable({ operation: "socket", message: "gap" })),
              }))
            : second.open,
        ),
      };
      const signals = yield* collect(wire);
      assert.strictEqual(opens, 2);
      assert.isTrue(signals.some((signal) => signal.phase === "recovering"));
      assert.strictEqual(signals.at(-1)?.processes[0]?.status, "FINISHED");
      assert.lengthOf(
        calls.filter((call) => call.path === "/process/search"),
        4,
      );
    }),
  );
  it.live("uses a fresh handle read even when GET carries no revision", () =>
    Effect.gen(function* () {
      let opens = 0;
      const calls: Array<{ path: string; body?: unknown }> = [];
      const first = wireOf({ calls, baseline: [row("RUNNING", 5)] });
      const second = wireOf({ calls, missing: { id: "J", status: "FINISHED" } });
      const wire: OperationWire = {
        makeId: () => "updates",
        open: Effect.suspend(() =>
          ++opens === 1
            ? Effect.map(first.open, (link) => ({
                ...link,
                frames: Stream.fail(new ZeropsUnavailable({ operation: "socket", message: "gap" })),
              }))
            : second.open,
        ),
      };
      const signals = yield* collect(wire).pipe(Effect.timeout(1_000));
      assert.strictEqual(signals.at(-1)?.processes[0]?.status, "FINISHED");
      assert.strictEqual(opens, 2);
    }),
  );
  it.live("does not retry a revoked credential", () =>
    Effect.gen(function* () {
      let opens = 0;
      const watch = makeOperationWatch({
        makeId: () => "updates",
        open: Effect.suspend(() => {
          opens++;
          return Effect.fail(
            new ZeropsRefused({
              operation: "login",
              reason: "unauthorized",
              code: "gone",
              status: 401,
            }),
          );
        }),
      });
      const error = yield* Stream.runDrain(watch.watch(target)).pipe(Effect.flip, Effect.scoped);
      assert.strictEqual(error._tag, "ZeropsRefused");
      assert.strictEqual(opens, 1);
    }),
  );
});
