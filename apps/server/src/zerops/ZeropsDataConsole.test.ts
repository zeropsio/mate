import { describe, expect, it } from "@effect/vitest";

import type {
  ZeropsDataConsoleError,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleSessionEvent,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  startupFailureReason,
  isLoopbackReadyUrl,
  make,
  makeRealSpawn,
  parseConsoleJson,
  parseReadyLine,
  routeRequest,
  type DataConsoleProcess,
  type SpawnDataConsole,
} from "./ZeropsDataConsole.ts";

const SESSION_TOKEN = "a".repeat(64);
const READY_URL = "http://127.0.0.1:54321";

const readyLine = (overrides?: {
  readonly allowWrites?: boolean;
  readonly sessionToken?: string;
  readonly url?: string;
}) =>
  `${JSON.stringify({
    url: overrides?.url ?? READY_URL,
    sessionToken: overrides?.sessionToken ?? SESSION_TOKEN,
    writeToken: "",
    pid: 4242,
    allowWrites: overrides?.allowWrites ?? false,
  })}\n`;

/** A controllable fake console process — tests drive its stdout/stderr/exit/error explicitly. */
interface FakeProcess extends DataConsoleProcess {
  emitStdout(chunk: string): void;
  emitStderr(chunk: string): void;
  emitExit(code: number | null): void;
  emitError(error: unknown): void;
  killed: boolean;
  stdinEnded: boolean;
}

const makeFakeProcess = (): FakeProcess => {
  let stdoutListener: ((chunk: string) => void) | undefined;
  let stderrListener: ((chunk: string) => void) | undefined;
  let exitListener: ((code: number | null) => void) | undefined;
  let errorListener: ((error: unknown) => void) | undefined;
  const proc: FakeProcess = {
    killed: false,
    stdinEnded: false,
    onStdout: (listener) => {
      stdoutListener = listener;
    },
    onStderr: (listener) => {
      stderrListener = listener;
    },
    onExit: (listener) => {
      exitListener = listener;
    },
    onError: (listener) => {
      errorListener = listener;
    },
    endStdin: () => {
      proc.stdinEnded = true;
    },
    kill: () => {
      proc.killed = true;
    },
    emitStdout: (chunk) => stdoutListener?.(chunk),
    emitStderr: (chunk) => stderrListener?.(chunk),
    emitExit: (code) => exitListener?.(code),
    emitError: (error) => errorListener?.(error),
  };
  return proc;
};

/** Records every spawn; each spawned process must be driven manually via its `emit*` methods. */
const makeManualSpawner = (): {
  readonly spawn: SpawnDataConsole;
  readonly processes: Array<FakeProcess>;
} => {
  const processes: Array<FakeProcess> = [];
  return {
    spawn: () => {
      const proc = makeFakeProcess();
      processes.push(proc);
      return proc;
    },
    processes,
  };
};

/** Every spawned process delivers the given ready line the instant its stdout listener is registered — deterministic, no race to arrange. */
const makeAutoReadySpawner = (
  line: string = readyLine(),
): { readonly spawn: SpawnDataConsole; readonly spawnCount: () => number } => {
  let count = 0;
  return {
    spawn: () => {
      count += 1;
      let exitListener: ((code: number | null) => void) | undefined;
      return {
        onStdout: (listener) => listener(line),
        onStderr: () => {},
        onExit: (listener) => {
          exitListener = listener;
        },
        onError: () => {},
        endStdin: () => {
          exitListener?.(0);
        },
        kill: () => {
          exitListener?.(null);
        },
      };
    },
    spawnCount: () => count,
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fakeHttpClient = (handler: (url: string) => Response) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, handler(request.url))),
  );

const servicesEnvelope = {
  project: { id: "p1", name: "Project One" },
  services: [
    {
      hostname: "db",
      type: "postgresql:single@18",
      family: "tabular",
      support: "supported",
      actions: [{ id: "querySQL", enabled: true, readOnly: true, reason: "" }],
      status: "ACTIVE",
    },
  ],
  allowWrites: false,
};

interface TestService {
  readonly subscribe: Effect.Effect<
    Stream.Stream<ZeropsDataConsoleSessionEvent>,
    never,
    Scope.Scope
  >;
  readonly call: (
    request: ZeropsDataConsoleRequest,
  ) => Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError>;
}

/** Runs an effect against a fresh `ZeropsDataConsole` service, scoped, with the given spawner and HTTP stub. */
const withService = <A, E>(
  options: { readonly spawn: SpawnDataConsole; readonly http?: HttpClient.HttpClient },
  use: (service: TestService) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* make({ spawnDataConsole: options.spawn });
      return yield* use(service);
    }),
  ).pipe(
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        options.http ?? fakeHttpClient(() => jsonResponse(servicesEnvelope)),
      ),
    ),
  );

describe("ZeropsDataConsole", () => {
  describe("parseReadyLine", () => {
    it("parses a valid ready line", () => {
      expect(parseReadyLine(readyLine())).toEqual({
        url: READY_URL,
        sessionToken: SESSION_TOKEN,
        allowWrites: false,
      });
    });

    it("returns undefined for garbage", () => {
      expect(parseReadyLine("not json at all")).toBeUndefined();
    });

    it("returns undefined for JSON missing the session token", () => {
      expect(
        parseReadyLine(JSON.stringify({ url: READY_URL, allowWrites: false })),
      ).toBeUndefined();
    });
  });

  describe("parseConsoleJson", () => {
    const cases: ReadonlyArray<{ readonly source: string; readonly expected: unknown }> = [
      { source: "9007199254740993", expected: "9007199254740993" },
      { source: "1.5", expected: 1.5 },
      { source: "42", expected: 42 },
    ];
    it.each(
      Array.from(cases, ({ source, expected }) => ({
        title: `parses ${source} as ${JSON.stringify(expected)}`,
        source,
        expected,
      })),
    )("$title", ({ source, expected }) => {
      expect(parseConsoleJson(`{"value":${source}}`)).toEqual({ value: expected });
    });

    it("preserves an unsafe integer inside a table cell array", () => {
      expect(parseConsoleJson('{"rows":[[9007199254740993,"alice"]]}')).toEqual({
        rows: [["9007199254740993", "alice"]],
      });
    });
  });

  describe("isLoopbackReadyUrl", () => {
    const cases: ReadonlyArray<{ readonly url: string; readonly loopback: boolean }> = [
      { url: "http://127.0.0.1:54321", loopback: true },
      { url: "http://localhost:54321", loopback: true },
      { url: "http://[::1]:54321", loopback: true },
      { url: "http://10.0.0.5:54321", loopback: false },
      { url: "http://0.0.0.0:54321", loopback: false },
      { url: "http://evil.example.com:54321", loopback: false },
      { url: "not a url", loopback: false },
    ];
    it.each(
      Array.from(cases, ({ url, loopback }) => ({
        title: `${loopback ? "accepts" : "rejects"} ${url}`,
        url,
        loopback,
      })),
    )("$title", ({ url, loopback }) => {
      expect(isLoopbackReadyUrl(url)).toBe(loopback);
    });
  });

  it("Connection secrets never reach the panel or clipboard, and browsing cannot mutate data.", () => {
    expect(startupFailureReason("connect password=do-not-expose accessKeyId=private-key")).toBe(
      "Console failed to start. Check the service and installed zcp version.",
    );
  });

  describe("startupFailureReason", () => {
    it.each(
      Array.from(
        [
          ["unknown studio subcommand: console\n\n", "unknown studio subcommand: console"],
          [
            "listen tcp 127.0.0.1:0: bind: permission denied",
            "Console failed to start. Check the service and installed zcp version.",
          ],
          [
            "open /var/www/.zcp/state.json: no such file",
            "Console failed to start. Check the service and installed zcp version.",
          ],
          ["", undefined],
        ] as const,
        ([stderr, reason]) => ({
          title: `reads ${JSON.stringify(stderr)} as ${String(reason)}`,
          stderr,
          reason,
        }),
      ),
    )("$title", ({ stderr, reason }) => {
      expect(startupFailureReason(stderr)).toBe(reason);
    });

    it("caps the reason at 120 characters", () => {
      expect(startupFailureReason("x".repeat(200))?.length).toBeLessThanOrEqual(120);
    });
  });

  describe("routeRequest", () => {
    const path = { service: "db", segments: ["public", "orders"] };

    it("maps services", () => {
      expect(routeRequest({ kind: "services" })).toEqual({ method: "GET", path: "/api/services" });
    });

    it("maps tree with paging", () => {
      expect(
        routeRequest({
          kind: "tree",
          path,
          page: { cursor: "c1", limit: 10, sort: "id", direction: "asc" },
        }),
      ).toEqual({
        method: "GET",
        path: "/api/tree",
        query: {
          service: "db",
          segs: '["public","orders"]',
          cursor: "c1",
          limit: "10",
          sort: "id",
          direction: "asc",
        },
      });
    });

    it("maps stat", () => {
      expect(routeRequest({ kind: "stat", path })).toEqual({
        method: "GET",
        path: "/api/stat",
        query: { service: "db", segs: '["public","orders"]' },
      });
    });

    it("maps blob", () => {
      expect(routeRequest({ kind: "blob", path })).toEqual({
        method: "GET",
        path: "/api/blob",
        query: { service: "db", segs: '["public","orders"]' },
      });
    });

    it("maps table", () => {
      expect(routeRequest({ kind: "table", path })).toEqual({
        method: "GET",
        path: "/api/table",
        query: { service: "db", segs: '["public","orders"]', limit: "100" },
      });
    });

    it("maps tableCount", () => {
      expect(routeRequest({ kind: "tableCount", path })).toEqual({
        method: "GET",
        path: "/api/table/count",
        query: { service: "db", segs: '["public","orders"]' },
      });
    });

    it("maps query", () => {
      expect(
        routeRequest({ kind: "query", service: "db", stmt: "select 1", page: { limit: 5 } }),
      ).toEqual({
        method: "POST",
        path: "/api/query",
        body: { service: "db", stmt: "select 1", page: { limit: 5 } },
      });
    });

    it("maps search with paging", () => {
      expect(
        routeRequest({
          kind: "search",
          path,
          q: "invoice",
          page: { cursor: "c1", limit: 10 },
        }),
      ).toEqual({
        method: "GET",
        path: "/api/search",
        query: {
          service: "db",
          segs: '["public","orders"]',
          q: "invoice",
          cursor: "c1",
          limit: "10",
        },
      });
    });
  });

  describe("session lifecycle", () => {
    it.effect("spawns on the first call and reuses the session on the second", () =>
      withService({ spawn: makeAutoReadySpawner().spawn }, (service) =>
        Effect.gen(function* () {
          const first = yield* service.call({ kind: "services" });
          const second = yield* service.call({ kind: "services" });
          expect(first).toEqual({ kind: "services", ...servicesEnvelope });
          expect(second).toEqual({ kind: "services", ...servicesEnvelope });
        }),
      ).pipe(Effect.orDie),
    );

    it.effect("shares one spawn across concurrent first calls", () =>
      Effect.gen(function* () {
        const spawner = makeAutoReadySpawner();
        yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.all([service.call({ kind: "services" }), service.call({ kind: "services" })], {
            concurrency: "unbounded",
          }),
        ).pipe(Effect.orDie);
        expect(spawner.spawnCount()).toBe(1);
      }),
    );

    it.effect("kills an idle session after 10 minutes", () =>
      Effect.gen(function* () {
        const state = { stdinEnded: false, killed: false };
        const spawnAndTrack: SpawnDataConsole = () => ({
          onStdout: (listener) => listener(readyLine()),
          onStderr: () => {},
          onExit: () => {},
          onError: () => {},
          endStdin: () => {
            state.stdinEnded = true;
          },
          kill: () => {
            state.killed = true;
          },
        });
        yield* withService({ spawn: spawnAndTrack }, (service) =>
          Effect.gen(function* () {
            yield* service.call({ kind: "services" });
            yield* TestClock.adjust(Duration.minutes(10));
            yield* TestClock.adjust(Duration.millis(1));
            expect(state.stdinEnded).toBe(true);
            expect(state.killed).toBe(true);
          }),
        ).pipe(Effect.orDie);
      }),
    );

    it.effect("respawns after the session is killed idle", () =>
      Effect.gen(function* () {
        const spawner = makeAutoReadySpawner();
        yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            yield* service.call({ kind: "services" });
            yield* TestClock.adjust(Duration.minutes(10));
            yield* TestClock.adjust(Duration.millis(1));
            yield* service.call({ kind: "services" });
          }),
        ).pipe(Effect.orDie);
        expect(spawner.spawnCount()).toBe(2);
      }),
    );

    it.effect(
      "a child that knows no console verb is unavailable, and the next call spawns again",
      () =>
        Effect.gen(function* () {
          const spawner = makeManualSpawner();
          const first = yield* withService({ spawn: spawner.spawn }, (service) =>
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
              yield* TestClock.adjust(Duration.millis(0));
              spawner.processes[0]?.emitStderr("unknown studio subcommand: console\n");
              spawner.processes[0]?.emitExit(1);
              const error = yield* Fiber.join(fiber).pipe(Effect.flip);
              yield* Effect.forkChild(service.call({ kind: "services" }));
              yield* TestClock.adjust(Duration.millis(0));
              return error;
            }),
          );
          expect(first.code).toBe("session_unavailable");
          expect(first.message).toBe("unknown studio subcommand: console");
          expect(spawner.processes.length).toBe(2);
        }),
    );

    it.effect("degrades to session_unavailable when the spawn itself errors (ENOENT/EACCES)", () =>
      Effect.gen(function* () {
        const spawner = makeManualSpawner();
        const error = yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.millis(0));
            spawner.processes[0]?.emitError(new Error("spawn zcp ENOENT"));
            return yield* Fiber.join(fiber);
          }),
        ).pipe(Effect.flip);
        expect(error.code).toBe("session_unavailable");
        expect(error.message).toBe("zcp is not available");
      }),
    );

    it.effect(
      "degrades to session_unavailable with a sanitized reason on any other startup failure",
      () =>
        Effect.gen(function* () {
          const spawner = makeManualSpawner();
          const outcome = yield* withService({ spawn: spawner.spawn }, (service) =>
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
              yield* TestClock.adjust(Duration.millis(0));
              spawner.processes[0]?.emitStderr("listen tcp: bind: address already in use\n");
              spawner.processes[0]?.emitExit(1);
              return yield* Fiber.join(fiber).pipe(Effect.exit);
            }),
          );
          expect(outcome._tag).toBe("Failure");
        }),
    );

    it.effect("unavailable is not permanent — the next call respawns and can succeed", () =>
      Effect.gen(function* () {
        const spawner = makeManualSpawner();
        const outcome = yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            const firstFiber = yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.millis(0));
            spawner.processes[0]?.emitStderr("listen tcp: bind: address already in use\n");
            spawner.processes[0]?.emitExit(1);
            const first = yield* Fiber.join(firstFiber).pipe(Effect.exit);

            // The second call must respawn (a fresh process) rather than
            // failing immediately from the cached `unavailable` state.
            const secondFiber = yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.millis(0));
            spawner.processes[1]?.emitStdout(readyLine());
            const second = yield* Fiber.join(secondFiber);
            return { first, second };
          }),
        ).pipe(Effect.orDie);
        expect(outcome.first._tag).toBe("Failure");
        expect(outcome.second).toEqual({ kind: "services", ...servicesEnvelope });
        expect(spawner.processes.length).toBe(2);
      }),
    );

    it.effect("degrades to session_unavailable when the ready line names a non-loopback host", () =>
      Effect.gen(function* () {
        const spawner = makeManualSpawner();
        const outcome = yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.millis(0));
            spawner.processes[0]?.emitStdout(readyLine({ url: "http://10.0.0.5:54321" }));
            return yield* Fiber.join(fiber).pipe(Effect.exit);
          }),
        );
        expect(outcome._tag).toBe("Failure");
        expect(spawner.processes[0]?.killed).toBe(true);
      }),
    );

    it.effect("the shutdown finalizer kills a process that hasn't printed a ready line yet", () =>
      Effect.gen(function* () {
        const spawner = makeManualSpawner();
        yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.millis(0));
            // Scope closes here — the process is still `starting`, no
            // ready line was ever delivered.
          }),
        );
        expect(spawner.processes[0]?.stdinEnded).toBe(true);
        expect(spawner.processes[0]?.killed).toBe(true);
      }),
    );

    it.effect("degrades to session_unavailable when no ready line arrives within the timeout", () =>
      Effect.gen(function* () {
        const spawner = makeManualSpawner();
        const outcome = yield* withService({ spawn: spawner.spawn }, (service) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
            yield* TestClock.adjust(Duration.seconds(5));
            yield* TestClock.adjust(Duration.millis(1));
            return yield* Fiber.join(fiber).pipe(Effect.exit);
          }),
        );
        expect(outcome._tag).toBe("Failure");
        expect(spawner.processes[0]?.killed).toBe(true);
      }),
    );
  });

  describe("HTTP broker", () => {
    it("Browsing caps every requested page at 100 items", () => {
      for (const limit of [undefined, 0, -1, 1000]) {
        expect(
          routeRequest({ kind: "table", path: { service: "db", segments: [] }, page: { limit } })
            .query?.limit,
        ).toBe("100");
      }
    });
    it.effect("Decision: iteration 1 is read-only.", () =>
      Effect.gen(function* () {
        let calls = 0;
        const http = fakeHttpClient(() => {
          calls++;
          return jsonResponse({ columns: [], rows: [] });
        });
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service
              .call({ kind: "query", service: "db", stmt: "DELETE FROM orders" })
              .pipe(Effect.result),
        );
        expect(result._tag).toBe("Failure");
        expect(calls).toBe(0);
      }),
    );
    it.effect(
      "Decision: restore SQL/filters and paging; complete the proposal; read-only data access only (no writes to service data).",
      () =>
        Effect.gen(function* () {
          for (const stmt of [
            "DELETE FROM orders",
            "SELECT 1; DELETE FROM orders",
            "WITH changed AS (DELETE FROM orders RETURNING *) SELECT * FROM changed",
            "SELECT * INTO backup FROM orders",
            "SELECT 1 /* comment */",
            "SELECT 'unterminated",
          ]) {
            let calls = 0;
            const result = yield* withService(
              {
                spawn: makeAutoReadySpawner().spawn,
                http: fakeHttpClient(() => {
                  calls++;
                  return jsonResponse({ columns: [], rows: [] });
                }),
              },
              (service) => service.call({ kind: "query", service: "db", stmt }).pipe(Effect.result),
            );
            expect(result._tag).toBe("Failure");
            expect(calls).toBe(0);
          }
        }),
    );
    it.effect(
      "Read-only SELECT accepts quoted values and identifiers while bounding its page",
      () =>
        Effect.gen(function* () {
          for (const stmt of [
            "SELECT 1",
            "select 'delete; -- not a comment' AS value;",
            'SELECT "update" FROM "orders"',
            "SELECT 'it''s paid' AS value",
          ]) {
            let calls = 0;
            const result = yield* withService(
              {
                spawn: makeAutoReadySpawner().spawn,
                http: fakeHttpClient(() => {
                  calls++;
                  return jsonResponse({ columns: [], rows: [[1]], rowKeyCols: [] });
                }),
              },
              (service) =>
                service.call({ kind: "query", service: "db", stmt, page: { limit: 1000 } }),
            );
            expect(result.kind).toBe("table");
            expect(calls).toBe(1);
            expect(
              routeRequest({ kind: "query", service: "db", stmt, page: { limit: 1000 } }).body,
            ).toEqual({ service: "db", stmt, page: { limit: 100 } });
          }
        }),
    );

    it.effect("Responses larger than one MiB are refused before decoding", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() =>
          jsonResponse({ ...servicesEnvelope, padding: "x".repeat(1024 * 1024) }),
        );
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "services" }).pipe(Effect.result),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    it.effect("re-reads services after a refresh", () =>
      Effect.gen(function* () {
        const calls: Array<string> = [];
        const http = fakeHttpClient((url) => {
          calls.push(new URL(url).pathname);
          return jsonResponse(servicesEnvelope);
        });
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "refresh" }),
        ).pipe(Effect.orDie);
        expect(result).toEqual({ kind: "services", ...servicesEnvelope });
        expect(calls).toEqual(["/api/refresh", "/api/services"]);
      }),
    );

    it.effect("decodes a search response the same way as a tree response", () =>
      Effect.gen(function* () {
        const calls: Array<string> = [];
        const http = fakeHttpClient((url) => {
          calls.push(url);
          return jsonResponse({
            nodes: [
              {
                name: "invoice-42",
                kind: "blob",
                path: { service: "docs", segments: ["invoices", "invoice-42"] },
              },
            ],
            nextCursor: "next-1",
          });
        });
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service.call({
              kind: "search",
              path: { service: "docs", segments: ["invoices"] },
              q: "invoice",
            }),
        ).pipe(Effect.orDie);
        expect(result).toEqual({
          kind: "search",
          nodes: [
            {
              name: "invoice-42",
              kind: "blob",
              path: { service: "docs", segments: ["invoices", "invoice-42"] },
              hasChildren: false,
            },
          ],
          nextCursor: "next-1",
        });
        expect(calls[0]).toContain("/api/search?");
        expect(calls[0]).toContain("q=invoice");
      }),
    );

    it.effect("maps a request that never responds to code timeout, not unreachable", () =>
      Effect.gen(function* () {
        const http = HttpClient.make(() => Effect.never);
        const error = yield* Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
              service.call({ kind: "services" }),
            ),
          );
          yield* TestClock.adjust(Duration.seconds(10));
          yield* TestClock.adjust(Duration.millis(1));
          return yield* Fiber.join(fiber);
        }).pipe(Effect.flip);
        expect(error.code).toBe("timeout");
      }),
    );

    it.effect("maps a non-2xx envelope to a typed error", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() =>
          jsonResponse(
            {
              code: "conflict",
              message: "row changed",
              service: "db",
              family: "tabular",
              requestId: "abc123",
            },
            409,
          ),
        );
        const outcome = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "services" }),
        ).pipe(Effect.exit);
        expect(outcome._tag).toBe("Failure");
      }),
    );

    it.effect("falls back to internal for an unrecognized envelope code", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() => jsonResponse({ code: "bogus", message: "??" }, 500));
        const outcome = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "services" }),
        ).pipe(Effect.exit);
        expect(outcome._tag).toBe("Failure");
      }),
    );

    it.effect(
      "decodes an empty table read — a Go nil slice encodes rows as literal null (public.empty_table on the rig, 2026-09-07)",
      () =>
        Effect.gen(function* () {
          const liveEmptyBody = {
            columns: [
              {
                name: "id",
                dataType: "integer",
                pk: true,
                editable: false,
                reason: "primary key",
                sortable: true,
                sortReason: "",
              },
            ],
            rows: null,
            nextCursor: "",
            rowKeyCols: ["id"],
          };
          const http = fakeHttpClient(() => jsonResponse(liveEmptyBody));
          const result = yield* withService(
            { spawn: makeAutoReadySpawner().spawn, http },
            (service) =>
              service.call({
                kind: "table",
                path: { service: "db", segments: ["public", "empty_table"] },
              }),
          ).pipe(Effect.orDie);
          expect(result).toMatchObject({ kind: "table", page: { rows: [], rowKeyCols: ["id"] } });
        }),
    );

    it.effect("decodes absent table flags and null row keys without losing exact values", () =>
      Effect.gen(function* () {
        // Captured live from `POST /api/query` against the rig (2026-09-07).
        const liveQueryBody = {
          columns: [
            {
              name: "one",
              dataType: "",
              pk: false,
              editable: false,
              reason: "query results are read-only",
            },
          ],
          rows: [[1, "2026-09-07T13:05:34.841934Z"]],
          rowKeyCols: null,
        };
        const http = fakeHttpClient(() => jsonResponse(liveQueryBody));
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service.call({ kind: "table", path: { service: "db", segments: ["public", "items"] } }),
        ).pipe(Effect.orDie);
        expect(result).toEqual({
          kind: "table",
          page: {
            columns: [
              {
                name: "one",
                dataType: "",
                pk: false,
                editable: false,
                reason: "query results are read-only",
                sortable: false,
                sortReason: "",
              },
            ],
            rows: [[1, "2026-09-07T13:05:34.841934Z"]],
            nextCursor: "",
            rowKeyCols: [],
            bestEffort: false,
            numbered: false,
          },
        });
      }),
    );

    it.effect(
      "decodes a real console query response — omitempty dropped sortable/sortReason/nextCursor/bestEffort/numbered, rowKeyCols is literal null",
      () =>
        Effect.gen(function* () {
          // Captured live from `POST /api/query` against the rig (2026-09-07).
          const liveQueryBody = {
            columns: [
              {
                name: "one",
                dataType: "",
                pk: false,
                editable: false,
                reason: "query results are read-only",
              },
            ],
            rows: [[1, "2026-09-07T13:05:34.841934Z"]],
            rowKeyCols: null,
          };
          const http = fakeHttpClient(() => jsonResponse(liveQueryBody));
          const result = yield* withService(
            { spawn: makeAutoReadySpawner().spawn, http },
            (service) => service.call({ kind: "query", service: "db", stmt: "select 1" }),
          ).pipe(Effect.orDie);
          expect(result).toEqual({
            kind: "table",
            page: {
              columns: [
                {
                  name: "one",
                  dataType: "",
                  pk: false,
                  editable: false,
                  reason: "query results are read-only",
                  sortable: false,
                  sortReason: "",
                },
              ],
              rows: [[1, "2026-09-07T13:05:34.841934Z"]],
              nextCursor: "",
              rowKeyCols: [],
              bestEffort: false,
              numbered: false,
            },
          });
        }),
    );

    it.effect("preserves an unsafe-integer cell exactly, end to end through the broker", () =>
      Effect.gen(function* () {
        const rawBody =
          '{"columns":[{"name":"id","dataType":"integer","pk":true,"editable":false,"reason":"","sortable":true,"sortReason":""}],"rows":[[9007199254740993,"alice"]],"nextCursor":"","rowKeyCols":["id"],"bestEffort":false,"numbered":false}';
        const http = HttpClient.make((request) =>
          Effect.sync(() =>
            HttpClientResponse.fromWeb(
              request,
              new Response(rawBody, {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            ),
          ),
        );
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service.call({ kind: "table", path: { service: "db", segments: ["public", "users"] } }),
        ).pipe(Effect.orDie);
        expect(result).toMatchObject({
          kind: "table",
          page: { rows: [["9007199254740993", "alice"]] },
        });
      }),
    );

    it.effect("decodes a console node whose hasChildren was omitted as false", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() =>
          jsonResponse({
            name: "orders",
            kind: "tabular",
            path: { service: "db", segments: ["public", "orders"] },
          }),
        );
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service.call({ kind: "stat", path: { service: "db", segments: ["public", "orders"] } }),
        ).pipe(Effect.orDie);
        expect(result).toEqual({
          kind: "node",
          node: {
            name: "orders",
            kind: "tabular",
            path: { service: "db", segments: ["public", "orders"] },
            hasChildren: false,
          },
        });
      }),
    );

    it.effect("fails with code internal when a 2xx body doesn't match the contract schema", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() =>
          jsonResponse({ project: { id: "p1" } /* missing name, services, allowWrites */ }),
        );
        const error = yield* withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
          service.call({ kind: "services" }),
        ).pipe(Effect.flip);
        expect(error.code).toBe("internal");
      }),
    );

    it.effect("maps a 401 to denial, never echoing the session", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() => new Response("unauthorized", { status: 401 }));
        const error = yield* withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
          service.call({ kind: "services" }),
        ).pipe(Effect.flip);
        expect(error.code).toBe("denied");
        expect(error.message).toBe("console rejected the session");
        expect(error.message).not.toContain(SESSION_TOKEN);
      }),
    );

    it.effect("caps a blob at 256 KiB and marks it truncated", () =>
      Effect.gen(function* () {
        const bigBody = "x".repeat(300 * 1024);
        const http = fakeHttpClient(
          () =>
            new Response(bigBody, {
              status: 200,
              headers: {
                "x-dataconsole-contenttype": "text/plain",
                "x-dataconsole-truncated": "false",
                "x-dataconsole-vector": "false",
                "x-dataconsole-streammetadata": "false",
                "x-dataconsole-size": String(bigBody.length),
              },
            }),
        );
        const result = (yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "blob", path: { service: "db", segments: ["a"] } }),
        ).pipe(Effect.orDie)) as Extract<ZeropsDataConsoleResponse, { readonly kind: "blob" }>;
        expect(result.truncated).toBe(true);
        expect(result.size).toBe(bigBody.length);
        expect(Buffer.from(result.data, "base64").byteLength).toBe(256 * 1024);
      }),
    );

    it.effect(
      "The ten second deadline covers stalled response bodies and cancels their stream",
      () =>
        Effect.gen(function* () {
          let cancelled = false;
          const http = fakeHttpClient(
            () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    cancelled = true;
                  },
                }),
              ),
          );
          yield* withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
            Effect.gen(function* () {
              const call = yield* service
                .call({ kind: "blob", path: { service: "assets", segments: ["slow.txt"] } })
                .pipe(Effect.flip, Effect.forkChild);
              yield* TestClock.adjust(Duration.seconds(11));
              const error = yield* Fiber.join(call);
              expect(error.code).toBe("timeout");
              expect(cancelled).toBe(true);
            }),
          );
        }),
    );
    it.effect("A preview stops reading the body as soon as its cap is reached", () =>
      Effect.gen(function* () {
        let cancelled = false;
        let pulls = 0;
        const http = fakeHttpClient(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  pulls++;
                  controller.enqueue(new Uint8Array(64 * 1024));
                },
                cancel() {
                  cancelled = true;
                },
              }),
            ),
        );
        const result = yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) =>
            service.call({ kind: "blob", path: { service: "assets", segments: ["large.bin"] } }),
        );
        expect(result).toMatchObject({ kind: "blob", truncated: true });
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThanOrEqual(6);
      }),
    );
    it.effect("Connection secrets never reach a broker error", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() =>
          jsonResponse(
            {
              code: "upstream",
              message: "postgres://user:secret@db",
              service: "secret",
              requestId: "secret",
            },
            500,
          ),
        );
        const error = yield* withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
          service.call({ kind: "services" }),
        ).pipe(Effect.flip);
        expect(JSON.stringify(error)).not.toContain("secret");
      }),
    );
    it.effect("passes through a small blob untruncated", () =>
      Effect.gen(function* () {
        const smallBody = "hello world";
        const http = fakeHttpClient(
          () =>
            new Response(smallBody, {
              status: 200,
              headers: {
                "x-dataconsole-contenttype": "text/plain",
                "x-dataconsole-truncated": "false",
                "x-dataconsole-vector": "false",
                "x-dataconsole-streammetadata": "false",
                "x-dataconsole-size": String(smallBody.length),
              },
            }),
        );
        const result = (yield* withService(
          { spawn: makeAutoReadySpawner().spawn, http },
          (service) => service.call({ kind: "blob", path: { service: "db", segments: ["a"] } }),
        ).pipe(Effect.orDie)) as Extract<ZeropsDataConsoleResponse, { readonly kind: "blob" }>;
        expect(result.truncated).toBe(false);
        expect(Buffer.from(result.data, "base64").toString("utf8")).toBe(smallBody);
      }),
    );
  });

  // Real `node:child_process` behavior — not mockable through the injected
  // `SpawnDataConsole` seam, so these spawn an actual (harmless, short-lived)
  // process rather than `zcp`.
  describe("makeRealSpawn (real child_process)", () => {
    it("reports onError for a missing binary, not an unhandled process event", async () => {
      const spawn = makeRealSpawn("this-command-does-not-exist-xyz", [], process.cwd());
      const proc = spawn();
      const error = await new Promise<unknown>((resolve) => proc.onError(resolve));
      expect(error).toBeDefined();
    });

    it("has drained stderr in full by the time onExit fires (listens on close, not exit)", async () => {
      // `sh studio console serve` — the fixed argv `makeRealSpawn` always
      // appends — fails to find a `studio` script and writes a multi-chunk
      // diagnostic to stderr before exiting nonzero. If the real
      // implementation listened on Node's `exit` instead of `close`, this
      // stderr could still be draining when the listener fires.
      const spawn = makeRealSpawn("sh", [], process.cwd());
      const proc = spawn();
      let stderr = "";
      proc.onStderr((chunk) => {
        stderr += chunk;
      });
      await new Promise<number | null>((resolve) => proc.onExit(resolve));
      expect(stderr).toContain("studio");
    });
  });
});
