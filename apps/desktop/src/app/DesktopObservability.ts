import {
  makeLocalFileTracer,
  makeTraceSink,
  otlpSerializationLayer,
} from "@t3tools/shared/observability";
import {
  parsePersistedServerObservabilitySettings,
  type PersistedServerObservabilitySettings,
} from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";
import { OtlpExporter, OtlpLogger, OtlpMetrics, OtlpTracer } from "effect/unstable/observability";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const DESKTOP_LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const DESKTOP_LOG_FILE_MAX_FILES = 10;
const DESKTOP_TRACE_BATCH_WINDOW_MS = 1_000;

export type DesktopLogAnnotations = Record<string, unknown>;

export interface DesktopComponentLogger {
  readonly annotate: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    annotations?: DesktopLogAnnotations,
  ) => Effect.Effect<A, E, R>;
  readonly logDebug: (message: string, annotations?: DesktopLogAnnotations) => Effect.Effect<void>;
  readonly logInfo: (message: string, annotations?: DesktopLogAnnotations) => Effect.Effect<void>;
  readonly logWarning: (
    message: string,
    annotations?: DesktopLogAnnotations,
  ) => Effect.Effect<void>;
  readonly logError: (message: string, annotations?: DesktopLogAnnotations) => Effect.Effect<void>;
}

export function makeComponentLogger(component: string): DesktopComponentLogger {
  const annotate: DesktopComponentLogger["annotate"] = (effect, annotations) =>
    effect.pipe(
      Effect.annotateLogs({
        component,
        ...annotations,
      }),
    );

  return {
    annotate,
    logDebug: (message, annotations) => annotate(Effect.logDebug(message), annotations),
    logInfo: (message, annotations) => annotate(Effect.logInfo(message), annotations),
    logWarning: (message, annotations) => annotate(Effect.logWarning(message), annotations),
    logError: (message, annotations) => annotate(Effect.logError(message), annotations),
  };
}

const noPersistedObservabilitySettings: PersistedServerObservabilitySettings = {
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
  otlpLogsUrl: undefined,
};

const readPersistedObservabilitySettings: Effect.Effect<
  PersistedServerObservabilitySettings,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const raw = yield* fileSystem.readFileString(environment.serverSettingsPath).pipe(Effect.option);
  return Option.isNone(raw)
    ? noPersistedObservabilitySettings
    : parsePersistedServerObservabilitySettings(raw.value);
});

/**
 * Settings is read once for all three signals, so the main process cannot
 * resolve traces against one revision of the file and logs against another.
 */
const resolveOtlpEndpoints = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const persisted = yield* readPersistedObservabilitySettings;
  return {
    traces: Option.getOrUndefined(environment.otlpTracesUrl) ?? persisted.otlpTracesUrl,
    metrics: Option.getOrUndefined(environment.otlpMetricsUrl) ?? persisted.otlpMetricsUrl,
    logs: Option.getOrUndefined(environment.otlpLogsUrl) ?? persisted.otlpLogsUrl,
  };
});

/**
 * Logs, traces, and metrics for the main process, assembled together because
 * they share one read of the environment and Settings, and because a process
 * gets exactly one logger set.
 */
const telemetryLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const endpoints = yield* resolveOtlpEndpoints;
    const headers = Option.getOrUndefined(environment.otlpHeaders);
    const serializationLayer = otlpSerializationLayer(environment.otlpProtocol);
    const resource = {
      serviceName: "desktop",
      attributes: {
        "service.runtime": "desktop",
        "service.mode": environment.isDevelopment ? "development" : "packaged",
      },
    };

    // `Logger.layer` writes the whole logger set rather than adding to it, so
    // every logger the main process wants has to be named in this one call.
    // Splitting the OTLP logger back out into a layer of its own silently
    // drops either it or the console output.
    //
    // Swapping `Logger.tracerLogger` out for the OTLP logger matches the
    // server: both reach a collector, but the tracer logger covers only
    // messages logged inside a recorded span and files them under traces,
    // while the OTLP logger carries every message as a log record stamped
    // with its trace and span ids. Keeping both would export every in-span
    // message twice.
    const loggerLayer = Logger.layer(
      endpoints.logs === undefined
        ? [Logger.consolePretty(), Logger.tracerLogger]
        : [
            Logger.consolePretty(),
            OtlpLogger.make({
              url: endpoints.logs,
              exportInterval: `${environment.otlpExportIntervalMs} millis`,
              headers,
              resource,
            }),
          ],
      { mergeWithExisting: false },
    ).pipe(Layer.provide(OtlpExporter.layerFlusher), Layer.provide(serializationLayer));

    const tracerLayer = Layer.unwrap(
      Effect.gen(function* () {
        const tracePath = environment.path.join(environment.logDir, "desktop.trace.ndjson");
        const sink = yield* makeTraceSink({
          filePath: tracePath,
          maxBytes: DESKTOP_LOG_FILE_MAX_BYTES,
          maxFiles: DESKTOP_LOG_FILE_MAX_FILES,
          batchWindowMs: DESKTOP_TRACE_BATCH_WINDOW_MS,
        });
        const delegate =
          endpoints.traces === undefined
            ? undefined
            : yield* OtlpTracer.make({
                url: endpoints.traces,
                exportInterval: `${environment.otlpExportIntervalMs} millis`,
                headers,
                resource,
              }).pipe(Effect.provide(serializationLayer));
        const tracer = yield* makeLocalFileTracer({
          filePath: tracePath,
          maxBytes: DESKTOP_LOG_FILE_MAX_BYTES,
          maxFiles: DESKTOP_LOG_FILE_MAX_FILES,
          batchWindowMs: DESKTOP_TRACE_BATCH_WINDOW_MS,
          sink,
          ...(delegate ? { delegate } : {}),
        });

        return Layer.succeed(Tracer.Tracer, tracer);
      }),
    ).pipe(Layer.provide(OtlpExporter.layerFlusher));

    const metricsLayer =
      endpoints.metrics === undefined
        ? Layer.empty
        : OtlpMetrics.layer({
            url: endpoints.metrics,
            exportInterval: `${environment.otlpExportIntervalMs} millis`,
            headers,
            resource,
          }).pipe(Layer.provide(serializationLayer));

    return Layer.mergeAll(loggerLayer, tracerLayer, metricsLayer);
  }),
);

export const layer = Layer.mergeAll(
  telemetryLayer,
  Layer.succeed(References.MinimumLogLevel, "Info"),
  Layer.succeed(Tracer.MinimumTraceLevel, "Info"),
  Layer.succeed(References.TracerTimingEnabled, true),
);
