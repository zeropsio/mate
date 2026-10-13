// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- a test Mate's own temp dirs and its loopback-only outbound door.
/**
 * A real Mate for browser scenarios, started in the test's process: the production server layer
 * (`makeServerLayer`) on a loopback port with its own temp state and temp home, linked to the
 * scenario's HQ by an enrollment file and to the platform fake by its API base. The scripted
 * provider is the only fake inside it.
 *
 * - **Time:** the server's `Clock` reads the scenario's wall clock (an offset from real time,
 *   never a TestClock): records carry the time the browser sees, and waits still pass in real time.
 * - **Outbound:** every `fetch` the server makes reaches only loopback; anything else is refused
 *   and kept in `refused` for the case to assert.
 * - **Home:** `homeDir` is a directory of its own, so nothing the Mate resolves under "home"
 *   lands in the developer's.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { FetchHttpClient, HttpServer } from "effect/http";

import * as ServerConfig from "../src/config.ts";
import { makeServerLayer } from "../src/server.ts";
import { ServerRuntimeStartup } from "../src/serverRuntimeStartup.ts";
import type { AnyProviderDriver } from "../src/provider/ProviderDriver.ts";

export interface ScenarioMateOptions {
  /** The project this Mate's container belongs to. */
  readonly projectId: string;
  readonly serviceId: string;
  readonly hostname: string;
  /** The platform fake's REST base, e.g. `http://127.0.0.1:1234/api/rest/public`. */
  readonly zeropsApiBaseUrl: string;
  /** The Mate's own platform key. */
  readonly zeropsApiToken: string;
  /** Where the browser reaches it, e.g. `https://zcp-a-8080.prg1.zerops.app`. */
  readonly publicOrigin: string;
  /** The HQ it is enrolled with; absent leaves it unenrolled. */
  readonly hq?: { readonly origin: string; readonly credential: string };
  /** The scenario's wall clock, in epoch milliseconds. */
  readonly now: () => number;
  readonly drivers: ReadonlyArray<AnyProviderDriver<never>>;
  /** A state directory to start from (a copied history); a fresh one when absent. */
  readonly stateFrom?: string;
}

export interface ScenarioMate {
  /** Loopback origin the server listens on. */
  readonly origin: string;
  readonly root: string;
  readonly homeDir: string;
  readonly stateDir: string;
  readonly dbPath: string;
  /** Outbound requests refused for leaving loopback. */
  readonly refused: ReadonlyArray<string>;
  /** Stops the server; its directories stay until `remove`. */
  readonly stop: () => Promise<void>;
  readonly remove: () => Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const scenarioClock = (now: () => number, base: Clock.Clock): Clock.Clock => ({
  currentTimeMillisUnsafe: now,
  currentTimeMillis: Effect.sync(now),
  currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
  currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: base.monotonicTimeNanos,
  sleep: (duration: Duration.Duration) => base.sleep(duration),
});

/** Starts a Mate and resolves once it accepts commands. */
export async function startScenarioMate(options: ScenarioMateOptions): Promise<ScenarioMate> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-mate-"));
  const baseDir = NodePath.join(root, "base");
  const homeDir = NodePath.join(root, "home");
  const cwd = NodePath.join(root, "workspace");
  await Promise.all([homeDir, cwd].map((dir) => NodeFSP.mkdir(dir, { recursive: true })));
  if (options.stateFrom)
    await NodeFSP.cp(options.stateFrom, NodePath.join(baseDir, "userdata"), { recursive: true });
  let hqEnrollmentPath: string | undefined;
  if (options.hq) {
    hqEnrollmentPath = NodePath.join(root, "hq", "enrollment.json");
    await NodeFSP.mkdir(NodePath.dirname(hqEnrollmentPath), { recursive: true });
    await NodeFSP.writeFile(
      hqEnrollmentPath,
      JSON.stringify({ hq: options.hq.origin, credential: options.hq.credential }),
      { mode: 0o600 },
    );
  }

  const refused: Array<string> = [];
  const loopbackFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!LOOPBACK.has(url.hostname)) {
      refused.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
      return Promise.reject(new TypeError(`Scenario Mate refused outbound ${url.origin}`));
    }
    return globalThis.fetch(input, init);
  }) as typeof globalThis.fetch;

  const scope = Scope.makeUnsafe();
  const boot = Effect.gen(function* () {
    const context = yield* Layer.buildWithScope(
      makeServerLayer({ drivers: options.drivers }),
      scope,
    );
    const ready = yield* ServerRuntimeStartup.pipe(Effect.provide(context));
    yield* ready.awaitCommandReady;
    const server = yield* HttpServer.HttpServer.pipe(Effect.provide(context));
    const address = server.address;
    if (!("port" in address)) return yield* Effect.die(new Error("Scenario Mate has no TCP port"));
    return { port: address.port };
  }).pipe(
    Effect.updateService(ServerConfig.ServerConfig, (config) => ({
      ...config,
      homeDir,
      basePath: "/mate",
      host: "127.0.0.1",
      zerops: {
        projectId: options.projectId,
        apiBaseUrl: options.zeropsApiBaseUrl,
        publicOrigin: options.publicOrigin,
        apiToken: options.zeropsApiToken,
        roleRecheckInterval: Duration.minutes(5),
        sessionMaxAge: Duration.days(30),
        hqEnrollmentPath,
        serviceId: options.serviceId,
        hostname: options.hostname,
        statusFile: NodePath.join(root, "zcp", "status.json"),
        mateUpdateStateFile: NodePath.join(root, "zcp", "update.json"),
      },
    })),
    Effect.provide(ServerConfig.layerTest(cwd, baseDir).pipe(Layer.provide(NodeServices.layer))),
    Effect.provideService(FetchHttpClient.Fetch, loopbackFetch),
  );
  // The clock reference is read where each fiber runs, so it is provided around the whole boot.
  const started = await Effect.runPromise(
    Effect.flatMap(Clock.Clock, (base) =>
      boot.pipe(Effect.provideService(Clock.Clock, scenarioClock(options.now, base))),
    ),
  ).catch(async (error: unknown) => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  });

  let stopped = false;
  return {
    origin: `http://127.0.0.1:${started.port}`,
    root,
    homeDir,
    stateDir: NodePath.join(baseDir, "userdata"),
    dbPath: NodePath.join(baseDir, "userdata", "state.sqlite"),
    refused,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
    remove: () => NodeFSP.rm(root, { recursive: true, force: true }),
  };
}
