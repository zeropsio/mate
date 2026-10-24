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
 * - **Home:** `homeDir` is a directory of its own and the platform's env store a file under
 *   `root`, so nothing the Mate reads or writes lands in the developer's home or `/etc`.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { FetchHttpClient, HttpServer } from "effect/http";

import { DataConsoleSpawn, type SpawnDataConsole } from "../src/zerops/ZeropsDataConsole.ts";
import * as ServerConfig from "../src/config.ts";
import { makeServerLayer } from "../src/server.ts";
import { scriptedClaudeSignIn } from "./scriptedClaudeSignIn.ts";
import { ServerRuntimeStartup } from "../src/serverRuntimeStartup.ts";
import { MateEngine, type MateEngineService } from "../src/engine/MateEngine.ts";
import { ZeropsMateAttention } from "../src/zerops/ZeropsMateAttention.ts";
import { ZeropsOffboarding } from "../src/zerops/ZeropsOffboarding.ts";
import { ZeropsBrowserStream } from "../src/zerops/ZeropsBrowserStream.ts";
import {
  ProviderInstances,
  layer as ProviderInstancesLayer,
} from "../src/spi/providerInstances.ts";
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
  /** The HQ it links to; the credential is the fake HQ's own. Absent, it links to none that answers. */
  readonly hq?: { readonly origin: string; readonly credential: string };
  /** The scenario's wall clock, in epoch milliseconds. */
  readonly now: () => number;
  readonly drivers: ReadonlyArray<AnyProviderDriver<never>>;
  /** The external zcp console process only; its protocol still goes through the real broker. */
  readonly spawnDataConsole?: SpawnDataConsole;
  /** The external native Claude login CLI, with scenario-only credentials. */
  readonly claudeSignIn?: boolean;
  /** A state directory to start from (a copied history); a fresh one when absent. */
  readonly stateFrom?: string;
  /** Per-boot environment input; never mutates the worker process environment. */
  readonly launchEnvironment?: NodeJS.ProcessEnv;
  /** Raw kernel directory discovery, read by the real resource collector. */
  readonly cgroupDirectories?: ReadonlyArray<string>;
}

export interface ScenarioMate {
  /** Loopback origin the server listens on. */
  readonly origin: string;
  /** The real engine and client wire, for seeding and projection witnesses. */
  readonly engine: MateEngineService;
  readonly attention: ZeropsMateAttention["Service"];
  readonly browser: ZeropsBrowserStream["Service"];
  readonly providers: ProviderInstances["Service"];
  /** Runs the production signer check after a platform membership input. */
  readonly offboarding: ZeropsOffboarding["Service"];
  readonly root: string;
  readonly homeDir: string;
  readonly stateDir: string;
  readonly dbPath: string;
  /** Outbound requests refused for leaving loopback. */
  readonly refused: ReadonlyArray<string>;
  /** Stops the server; its directories stay until `remove`. */
  readonly stop: () => Promise<void>;
  /** Stops it and starts it again on the same state, home and port, as a restarted container. */
  readonly restart: () => Promise<void>;
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
  else {
    // The scripted agent stands in for OpenCode, which a user opts in to from Settings.
    await NodeFSP.mkdir(NodePath.join(baseDir, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(baseDir, "userdata", "settings.json"),
      JSON.stringify({ providers: { opencode: { enabled: true } } }),
    );
  }
  const nativeServices = options.claudeSignIn
    ? await scriptedClaudeSignIn({ root, homeDir, cwd })
    : undefined;

  const refused: Array<string> = [];
  const loopbackFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!LOOPBACK.has(url.hostname)) {
      refused.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
      return Promise.reject(new TypeError(`Scenario Mate refused outbound ${url.origin}`));
    }
    return globalThis.fetch(input, init);
  }) as typeof globalThis.fetch;

  const boot = async (port: number) => {
    const scope = Scope.makeUnsafe();
    const server = Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(
        makeServerLayer({
          drivers: options.drivers,
          ...(nativeServices ? { nativeServices } : {}),
        }),
        scope,
      );
      const ready = yield* ServerRuntimeStartup.pipe(Effect.provide(context));
      yield* ready.awaitCommandReady;
      const http = yield* HttpServer.HttpServer.pipe(Effect.provide(context));
      const address = http.address;
      if (!("port" in address))
        return yield* Effect.die(new Error("Scenario Mate has no TCP port"));
      const engine = yield* MateEngine.pipe(Effect.provide(context));
      const clock = yield* Clock.Clock;
      // This harness boots live feeds; the server layer's common type also includes fixture feeds,
      // which do not expose offboarding. Require the actual live service from the built context.
      const offboardingService = Context.getUnsafe(context, ZeropsOffboarding);
      // A direct worker receipt keeps this Mate's clock, including its platform answer's age.
      const offboarding = {
        checkNow: offboardingService.checkNow.pipe(Effect.provideService(Clock.Clock, clock)),
      };
      const attention = yield* ZeropsMateAttention.pipe(Effect.provide(context));
      const browser = yield* ZeropsBrowserStream.pipe(Effect.provide(context));
      const providers = yield* ProviderInstances.pipe(
        Effect.provide(ProviderInstancesLayer),
        Effect.provide(context),
      );
      return { port: address.port, engine, attention, browser, providers, offboarding };
    }).pipe(
      Effect.updateService(ServerConfig.ServerConfig, (config) => ({
        ...config,
        homeDir,
        ...(options.cgroupDirectories === undefined
          ? {}
          : { cgroupDirectories: options.cgroupDirectories }),
        // A container's Mate opens on its workspace as its project, as `mate serve` does.
        autoBootstrapProjectFromCwd: true,
        // A test Mate never opens the developer's browser on its origin.
        noBrowser: true,
        basePath: "/mate",
        host: "127.0.0.1",
        port,
        zerops: {
          projectId: options.projectId,
          apiBaseUrl: options.zeropsApiBaseUrl,
          publicOrigin: options.publicOrigin,
          apiToken: options.zeropsApiToken,
          // A scene without an HQ links to none that answers: never production's.
          hqOrigin: options.hq?.origin ?? "http://127.0.0.1:9",
          hqGitCredentialPath: NodePath.join(root, "hq", "git-credential"),
          serviceId: options.serviceId,
          hostname: options.hostname,
          statusFile: NodePath.join(root, "zcp", "status.json"),
          mateUpdateStateFile: NodePath.join(root, "zcp", "update.json"),
          envStorePath: NodePath.join(root, "zembed", "env.json"),
        },
      })),
      Effect.provide(ServerConfig.layerTest(cwd, baseDir).pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(FetchHttpClient.Fetch, loopbackFetch),
      Effect.provideService(DataConsoleSpawn, options.spawnDataConsole),
      Effect.provideService(HostProcessEnvironment, {
        ...process.env,
        ...options.launchEnvironment,
      }),
    );
    // The clock reference is read where each fiber runs, so it is provided around the whole boot.
    const bound = await Effect.runPromise(
      Effect.flatMap(Clock.Clock, (base) =>
        server.pipe(Effect.provideService(Clock.Clock, scenarioClock(options.now, base))),
      ),
    ).catch(async (error: unknown) => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    });
    return { scope, ...bound };
  };

  let running: Awaited<ReturnType<typeof boot>> | undefined = await boot(0);
  const port = running.port;
  const stop = async () => {
    const closing = running;
    running = undefined;
    if (closing) await Effect.runPromise(Scope.close(closing.scope, Exit.void));
  };
  return {
    origin: `http://127.0.0.1:${port}`,
    get offboarding() {
      if (!running) throw new Error("Scenario Mate is stopped");
      return running.offboarding;
    },
    get attention() {
      if (!running) throw new Error("Scenario Mate is stopped");
      return running.attention;
    },
    get browser() {
      if (!running) throw new Error("Scenario Mate is stopped");
      return running.browser;
    },
    get providers() {
      if (!running) throw new Error("Scenario Mate is stopped");
      return running.providers;
    },
    get engine() {
      if (!running) throw new Error("Scenario Mate is stopped");
      return running.engine;
    },
    root,
    homeDir,
    stateDir: NodePath.join(baseDir, "userdata"),
    dbPath: NodePath.join(baseDir, "userdata", "state.sqlite"),
    refused,
    stop,
    restart: async () => {
      await stop();
      running = await boot(port);
    },
    remove: () => NodeFSP.rm(root, { recursive: true, force: true }),
  };
}
