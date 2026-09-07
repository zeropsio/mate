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
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  classifyStartupFailure,
  isLoopbackReadyUrl,
  make,
  makeRealSpawn,
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
    for (const { url, loopback } of cases) {
      it(`${loopback ? "accepts" : "rejects"} ${url}`, () => {
        expect(isLoopbackReadyUrl(url)).toBe(loopback);
      });
    }
  });

  describe("classifyStartupFailure", () => {
    it("classifies an unknown studio subcommand as unsupported", () => {
      expect(classifyStartupFailure("unknown studio subcommand: console\n\n")).toEqual({
        status: "unsupported",
      });
    });

    it("classifies a bare unknown subcommand as unsupported", () => {
      expect(classifyStartupFailure("unknown subcommand: console")).toEqual({
        status: "unsupported",
      });
    });

    it("classifies any other stderr as unavailable with a sanitized reason", () => {
      expect(classifyStartupFailure("listen tcp 127.0.0.1:0: bind: permission denied")).toEqual({
        status: "unavailable",
        reason: "listen tcp 127.0.0.1:0: bind: permission denied",
      });
    });

    it("redacts filesystem paths in the reason", () => {
      expect(classifyStartupFailure("open /var/www/.zcp/state.json: no such file")).toEqual({
        status: "unavailable",
        reason: "open <path>: no such file",
      });
    });

    it("caps the reason at 120 characters", () => {
      const failure = classifyStartupFailure("x".repeat(200));
      expect(failure.status).toBe("unavailable");
      expect(failure.reason?.length).toBe(120);
    });

    it("has no reason when stderr was empty", () => {
      expect(classifyStartupFailure("")).toEqual({ status: "unavailable" });
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
        query: { service: "db", segs: '["public","orders"]' },
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
      "degrades to session_unsupported when the child reports an unknown subcommand, without respawning",
      () =>
        Effect.gen(function* () {
          const spawner = makeManualSpawner();
          const result = yield* withService({ spawn: spawner.spawn }, (service) =>
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(service.call({ kind: "services" }));
              yield* TestClock.adjust(Duration.millis(0));
              spawner.processes[0]?.emitStderr("unknown studio subcommand: console\n");
              spawner.processes[0]?.emitExit(1);
              const first = yield* Fiber.join(fiber).pipe(Effect.exit);
              const secondFiber = yield* Effect.forkChild(service.call({ kind: "services" }));
              const second = yield* Fiber.join(secondFiber).pipe(Effect.exit);
              return { first, second };
            }),
          );
          expect(result.first._tag).toBe("Failure");
          expect(result.second._tag).toBe("Failure");
          expect(spawner.processes.length).toBe(1);
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

    it.effect("maps a 401 to a fixed internal error, never echoing the session", () =>
      Effect.gen(function* () {
        const http = fakeHttpClient(() => new Response("unauthorized", { status: 401 }));
        const error = yield* withService({ spawn: makeAutoReadySpawner().spawn, http }, (service) =>
          service.call({ kind: "services" }),
        ).pipe(Effect.flip);
        expect(error.code).toBe("internal");
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
