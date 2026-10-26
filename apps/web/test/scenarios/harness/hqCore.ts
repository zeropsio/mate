// @effect-diagnostics nodeBuiltinImport:off -- disposable Core loopback socket receipts.
import {
  hqScopeKey,
  HqStreamMessage,
  HqStreamRequest,
  type HqScope,
} from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WebSocket } from "ws";
import { TempPostgres } from "../../../../hq/test/harness/tempPostgres.ts";
import { startCore } from "../../../../hq/test/harness/runningCore.ts";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import { deadline } from "./http.ts";
import { startExternalCore, type GithubAddress } from "./externalCore.ts";

const readMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamMessage));
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(HqStreamRequest));

/** Real Core navigation, through its baseline or a caller's source receipt. */
export const openScenarioNavigation = (
  origin: string,
  ticket: string,
  ready: (message: HqStreamMessage) => boolean = (message) =>
    message.type === "scope-ready" && message.scope.kind === "navigation",
  scope: HqScope = { kind: "navigation" },
) =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      Effect.sync(
        () => new WebSocket(`${origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`),
      ),
      (socket) => Effect.sync(() => socket.terminate()),
    );
    yield* Effect.promise(() =>
      deadline(
        new Promise<void>((resolve, reject) => {
          socket.once("error", reject);
          socket.once("close", (code) => reject(new Error(`Core navigation closed (${code})`)));
          socket.once("open", () =>
            socket.send(
              encodeRequest({
                type: "subscribe",
                scopes: [{ scope }],
              }),
            ),
          );
          socket.on("message", (frame) => {
            const parsed = readMessage(frame.toString());
            if (Option.isNone(parsed)) return reject(new Error("Invalid Core navigation delivery"));
            const message = parsed.value;
            if (message.type === "ping") {
              socket.send(encodeRequest({ type: "pong" }));
              return;
            }
            if (message.type === "scope-error" && hqScopeKey(message.scope) === hqScopeKey(scope)) {
              return reject(
                new Error(
                  `Core navigation failed (${message.code})${message.reason === null ? "" : `: ${message.reason}`}`,
                ),
              );
            }
            if (ready(message)) resolve();
          });
        }),
        "Core navigation ready",
      ),
    );
    return socket;
  });

/** Milliseconds; overrides are local to one scenario. */
export interface HqTimings {
  pingEvery?: number;
  reconcileEvery?: number;
  streamRecheck?: number;
}

export function startScenarioCore(
  zeropsHttp: { baseUrl: string; world: FakeWorld; github?: GithubAddress },
  timings: HqTimings = {},
) {
  return Effect.gen(function* () {
    const command = process.env.MATE_HQ_TEST_COMMAND;
    if (command)
      return {
        ...(yield* startExternalCore(command, zeropsHttp, timings)),
        kind: "external" as const,
      };
    const url = yield* (yield* TempPostgres).createMigratedDatabase;
    const core = yield* startCore(true, {
      url,
      zeropsHttp,
      pingEvery: Duration.millis(timings.pingEvery ?? 20_000),
      reconcileEvery: Duration.millis(timings.reconcileEvery ?? 60_000),
      streamRecheck: Duration.millis(timings.streamRecheck ?? 30_000),
    });
    return { ...core, kind: "in-process" as const };
  });
}

export type ScenarioCore = Effect.Success<ReturnType<typeof startScenarioCore>>;

/** These older cases inspect the embedded Core; the process protocol exposes no SQL or services. */
export function inProcessCore(core: ScenarioCore) {
  if (core.kind !== "in-process")
    throw new Error(
      "This scenario requires in-process Core internals; use an HQ API witness before running it with MATE_HQ_TEST_COMMAND",
    );
  return core;
}
