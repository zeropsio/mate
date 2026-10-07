/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { sweepStalePendingAttachments } from "./attachmentStore.ts";
import { sweepPartialUploads } from "./uploadsFolder.ts";
import { DEFAULT_SIGNAL_EXPORT, type SignalExport } from "@t3tools/shared/observability";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";
import type { ZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";

export const DEFAULT_PORT = 3773;

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const StartupPresentation = Schema.Literals(["browser", "headless"]);
export type StartupPresentation = typeof StartupPresentation.Type;

export type MateEngineMode = "v1" | "mate";

/**
 * Reads `T3CODE_MATE_ENGINE` leniently: trimmed and case-blind, absent or
 * empty is `v1`, and a name it does not know is `v1` flagged `unknown` so the
 * caller warns instead of crash-looping the unit.
 */
export const readMateEngine = (
  raw: string | undefined,
): { readonly engine: MateEngineMode; readonly unknown: boolean } => {
  const name = raw?.trim().toLowerCase() ?? "";
  if (name === "mate") return { engine: "mate", unknown: false };
  return { engine: "v1", unknown: name !== "" && name !== "v1" };
};

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly keybindingsConfigPath: string;
  readonly settingsPath: string;
  readonly providerStatusCacheDir: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  /** Where every file a person sends is kept under its own name, for them and the agent. */
  readonly uploadsDir: string;
  /** Which stored attachment was kept under which name in the uploads folder. */
  readonly uploadsIndexDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  /** The Mate's start epoch: beside the environment id, so the two reset together. */
  readonly mateEpochPath: string;
  readonly serverRuntimeStatePath: string;
  readonly secretsDir: string;
}

export interface DeriveServerPathsOptions {
  readonly baseDirIsExplicit?: boolean;
}

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends Context.Service<
  ServerConfig,
  ServerDerivedPaths & {
    readonly logLevel: LogLevel.LogLevel;
    readonly traceMinLevel: LogLevel.LogLevel;
    readonly traceTimingEnabled: boolean;
    readonly traceBatchWindowMs: number;
    readonly traceMaxBytes: number;
    readonly traceMaxFiles: number;
    readonly otlpTracesUrl: string | undefined;
    readonly otlpMetricsUrl: string | undefined;
    readonly otlpLogsUrl: string | undefined;
    /**
     * How each signal is exported. Read instead of a process-wide setting so
     * the wire format, credential, and schedule travel with the endpoint they
     * were configured beside.
     */
    readonly otlpTracesExport: SignalExport;
    readonly otlpMetricsExport: SignalExport;
    readonly otlpLogsExport: SignalExport;
    readonly otlpServiceName: string;
    readonly otelEnvironment: OtelEnvironment.OtelEnvironment;
    readonly mode: RuntimeMode;
    readonly port: number;
    readonly host: string | undefined;
    /**
     * The public path prefix this server is published under, in normal form
     * (`""` at an origin root, otherwise `/mate`). Routes stay mounted at the
     * root — the recommended proxy strips the prefix — so this is what the
     * server needs to emit correct absolute URLs and to advertise itself.
     */
    readonly basePath: string;
    readonly cwd: string;
    readonly baseDir: string;
    readonly staticDir: string | undefined;
    readonly devUrl: URL | undefined;
    readonly devAllowedOrigins: ReadonlyArray<string>;
    /** A showcase scene id or absolute scene JSON path used by the four Zerops fixture feeds. */
    readonly zeropsFixtures: string | undefined;
    /**
     * Present only inside a Zerops project container. Its presence is the
     * single rule that turns on every Zerops-specific behaviour - use
     * `isZeropsEnvironment` rather than testing this field by hand.
     */
    readonly zerops: ZeropsEnvironment | undefined;
    /**
     * Crew mode's switch (`T3CODE_ZEROPS_CREW`, on unless turned off). An env
     * variable and never a `serve` flag: zcp passes flags unconditionally, and
     * an unknown one crash-loops the unit. It only matters inside a Zerops
     * project, and with no crew applied a Mate stays byte-identical.
     */
    readonly zeropsCrew: boolean;
    /**
     * Which engine owns this Mate's conversation (`T3CODE_MATE_ENGINE`): `v1`
     * unless `mate`. An env variable, never a `serve` flag, valid everywhere
     * and not only in Zerops; an unknown value runs V1 (see `readMateEngine`).
     */
    readonly mateEngine: MateEngineMode;
    readonly noBrowser: boolean;
    readonly startupPresentation: StartupPresentation;
    readonly desktopBootstrapToken: string | undefined;
    readonly desktopTelemetryFd?: number | undefined;
    readonly desktopTelemetryControlFd?: number | undefined;
    readonly resourceMonitorPath?: string | undefined;
    readonly autoBootstrapProjectFromCwd: boolean;
    readonly logWebSocketEvents: boolean;
  }
>()("t3/config/ServerConfig") {
  /** @deprecated Import and use `layerTest` from this module. */
  static readonly layerTest = (
    cwd: string,
    baseDirOrPrefix: string | { readonly prefix: string },
  ) => layerTest(cwd, baseDirOrPrefix);
}

export const make = (config: ServerConfig["Service"]) => ServerConfig.of(config);

/**
 * Resource attributes shared by every OTLP exporter, so traces, metrics, and
 * logs report the same service identity to the collector.
 */
export const otlpResource = (config: ServerConfig["Service"]) => ({
  serviceName: config.otlpServiceName,
  attributes: {
    "service.runtime": "t3-server",
    "service.mode": config.mode,
  },
});

export const layer = (config: ServerConfig["Service"]) => Layer.succeed(ServerConfig, make(config));

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfig["Service"]["baseDir"],
  devUrl: ServerConfig["Service"]["devUrl"],
  options: DeriveServerPathsOptions = {},
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(
    baseDir,
    devUrl !== undefined && !options.baseDirIsExplicit ? "dev" : "userdata",
  );
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  const providerStatusCacheDir = join(baseDir, "caches");
  return {
    stateDir,
    dbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    settingsPath: join(stateDir, "settings.json"),
    providerStatusCacheDir,
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    uploadsDir: join(baseDir, "uploads"),
    uploadsIndexDir: join(baseDir, "uploads-index"),
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(stateDir, "environment-id"),
    mateEpochPath: join(stateDir, "mate-epoch"),
    serverRuntimeStatePath: join(stateDir, "server-runtime.json"),
    secretsDir: join(stateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (derivedPaths: ServerDerivedPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Effect.all(
    [
      fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
      fs.makeDirectory(derivedPaths.providerStatusCacheDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.serverRuntimeStatePath), { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );

  const nowMs = yield* Clock.currentTimeMillis;
  const swept = sweepStalePendingAttachments({
    attachmentsDir: derivedPaths.attachmentsDir,
    nowMs,
  });
  if (swept.deleted > 0) {
    yield* Effect.logInfo("Removed expired attachment uploads.", { deleted: swept.deleted });
  }
  const partials = yield* Effect.promise(() =>
    sweepPartialUploads({ uploadsDir: derivedPaths.uploadsDir, nowMs }),
  );
  if (partials.deleted > 0) {
    yield* Effect.logInfo("Removed unfinished uploads-folder copies.", {
      deleted: partials.deleted,
    });
  }
});

const makeTest = Effect.fn("ServerConfig.makeTest")(function* (
  cwd: string,
  baseDirOrPrefix: string | { readonly prefix: string },
) {
  const devUrl = undefined;
  const fs = yield* FileSystem.FileSystem;
  const baseDir =
    typeof baseDirOrPrefix === "string"
      ? baseDirOrPrefix
      : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
  const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
  yield* ensureServerDirectories(derivedPaths);

  return ServerConfig.of({
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpLogsUrl: undefined,
    otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
    otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
    otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
    otlpServiceName: "t3-server",
    otelEnvironment: OtelEnvironment.none,
    cwd,
    baseDir,
    ...derivedPaths,
    mode: "web",
    basePath: "",
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    port: 0,
    host: undefined,
    desktopBootstrapToken: undefined,
    desktopTelemetryFd: undefined,
    desktopTelemetryControlFd: undefined,
    resourceMonitorPath: undefined,
    staticDir: undefined,
    devUrl,
    devAllowedOrigins: [],
    zeropsFixtures: undefined,
    zerops: undefined,
    zeropsCrew: true,
    mateEngine: "v1",
    noBrowser: false,
    startupPresentation: "browser",
  });
});

export const layerTest = (cwd: string, baseDirOrPrefix: string | { readonly prefix: string }) =>
  Layer.effect(ServerConfig, makeTest(cwd, baseDirOrPrefix));

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;
  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});
