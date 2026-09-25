import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopObservability from "./DesktopObservability.ts";

const TraceRecordLine = Schema.Struct({
  name: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  events: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      attributes: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});

const decodeTraceRecordLine = Schema.decodeUnknownSync(Schema.fromJsonString(TraceRecordLine));

const environmentInput = (baseDir: string) =>
  ({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: false,
    resourcesPath: "/repo/resources",
    runningUnderArm64Translation: false,
  }) satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  baseDir: string,
  isDevelopment = true,
  env: Readonly<Record<string, string | undefined>> = {},
) =>
  DesktopEnvironment.layer(environmentInput(baseDir)).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          T3CODE_HOME: baseDir,
          VITE_DEV_SERVER_URL: isDevelopment ? "http://127.0.0.1:5733" : undefined,
          ...env,
        }),
      ),
    ),
  );

interface ExportedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Answers every export with a 200 and keeps what was posted for assertions. */
const collectorLayer = (requests: Array<ExportedRequest>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push({
          url: request.url,
          headers: request.headers,
          body:
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        });
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }));
      }),
    ),
  );

const encodeObservabilitySettingsFile = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ observability: Schema.Record(Schema.String, Schema.String) }),
  ),
);

const writeObservabilitySettings = Effect.fn(function* (
  environmentLayer: ReturnType<typeof makeEnvironmentLayer>,
  observability: Readonly<Record<string, string>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const { path, serverSettingsPath } = yield* Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment;
  }).pipe(Effect.provide(environmentLayer));
  yield* fileSystem.makeDirectory(path.dirname(serverSettingsPath), { recursive: true });
  yield* fileSystem.writeFileString(
    serverSettingsPath,
    encodeObservabilitySettingsFile({ observability }),
  );
});

describe("DesktopObservability", () => {
  it.effect("persists desktop Effect logs as span events in desktop.trace.ndjson", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-observability-test-",
      });
      const environmentLayer = makeEnvironmentLayer(baseDir);
      const tracePath = yield* Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        return environment.path.join(environment.logDir, "desktop.trace.ndjson");
      }).pipe(Effect.provide(environmentLayer));
      const logPath = yield* Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        return environment.path.join(environment.logDir, "desktop-main.log");
      }).pipe(Effect.provide(environmentLayer));

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({ "desktop.test": true });
          yield* Effect.logInfo("desktop trace event");
        }).pipe(
          Effect.withSpan("desktop-observability-test"),
          Effect.provide(DesktopObservability.layer.pipe(Layer.provideMerge(environmentLayer))),
        ),
      );

      const records = (yield* fileSystem.readFileString(tracePath))
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => decodeTraceRecordLine(line));
      const record = records.find((entry) => entry.name === "desktop-observability-test");

      assert.notEqual(record, undefined);
      if (!record) {
        return;
      }
      assert.equal(record.attributes["desktop.test"], true);
      assert.equal(
        record.events.some((event) => event.name === "desktop trace event"),
        true,
      );
      assert.isFalse(yield* fileSystem.exists(logPath));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
    ),
  );

  it.effect("exports main process log records to the configured logs endpoint", () => {
    const requests: Array<ExportedRequest> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-observability-test-",
      });
      const environmentLayer = makeEnvironmentLayer(baseDir, true, {
        T3CODE_OTLP_LOGS_URL: "https://collector.example.com/v1/logs",
        T3CODE_OTLP_HEADERS: "x-scope=desktop",
      });
      const tracePath = yield* Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        return environment.path.join(environment.logDir, "desktop.trace.ndjson");
      }).pipe(Effect.provide(environmentLayer));

      yield* Effect.scoped(
        Effect.logInfo("desktop log export").pipe(
          Effect.withSpan("desktop-log-export-test"),
          Effect.provide(DesktopObservability.layer.pipe(Layer.provideMerge(environmentLayer))),
        ),
      );

      assert.lengthOf(requests, 1);
      const [request] = requests;
      assert.strictEqual(request?.url, "https://collector.example.com/v1/logs");
      assert.include(request?.body ?? "", "desktop log export");
      assert.include(request?.body ?? "", "service.runtime");
      assert.strictEqual(request?.headers["x-scope"], "desktop");

      // The log record is the export now, so the same message must not also
      // ride along as an event on the span.
      const record = (yield* fileSystem.readFileString(tracePath))
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => decodeTraceRecordLine(line))
        .find((entry) => entry.name === "desktop-log-export-test");
      assert.notEqual(record, undefined);
      assert.lengthOf(record?.events ?? [], 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, collectorLayer(requests))),
    );
  });

  it.effect("reads every signal endpoint from Settings when the environment names none", () => {
    const requests: Array<ExportedRequest> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-observability-test-",
      });
      const environmentLayer = makeEnvironmentLayer(baseDir);
      yield* writeObservabilitySettings(environmentLayer, {
        otlpTracesUrl: "https://settings.example.com/v1/traces",
        otlpLogsUrl: "https://settings.example.com/v1/logs",
        // The main process records no metrics yet, so this endpoint must
        // not produce a request.
        otlpMetricsUrl: "https://settings.example.com/v1/metrics",
      });

      yield* Effect.scoped(
        Effect.logInfo("desktop log export from settings").pipe(
          Effect.withSpan("desktop-settings-export-test"),
          Effect.provide(DesktopObservability.layer.pipe(Layer.provideMerge(environmentLayer))),
        ),
      );

      assert.deepEqual(requests.map((request) => request.url).toSorted(), [
        "https://settings.example.com/v1/logs",
        "https://settings.example.com/v1/traces",
      ]);
      assert.include(
        requests.find((request) => request.url.endsWith("/v1/logs"))?.body ?? "",
        "desktop log export from settings",
      );
      assert.include(
        requests.find((request) => request.url.endsWith("/v1/traces"))?.body ?? "",
        "desktop-settings-export-test",
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, collectorLayer(requests))),
    );
  });

  it.effect("stays off the network when no endpoint is configured", () => {
    const requests: Array<ExportedRequest> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-observability-test-",
      });

      yield* Effect.scoped(
        Effect.logInfo("desktop log stays local").pipe(
          Effect.withSpan("desktop-offline-test"),
          Effect.provide(
            DesktopObservability.layer.pipe(Layer.provideMerge(makeEnvironmentLayer(baseDir))),
          ),
        ),
      );

      assert.lengthOf(requests, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, collectorLayer(requests))),
    );
  });
});
