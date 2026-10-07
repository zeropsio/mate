// @effect-diagnostics nodeBuiltinImport:off -- disposable Core loopback socket receipts.
import { HqStreamMessage, HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WebSocket } from "ws";
import { startCore } from "../../../../hq/test/harness/runningCore.ts";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import { deadline } from "./http.ts";

const readMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamMessage));
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(HqStreamRequest));

/** Real Core navigation, through its baseline or a caller's source receipt. */
export const openScenarioNavigation = (
  origin: string,
  ticket: string,
  ready: (message: HqStreamMessage) => boolean = (message) =>
    message.type === "scope-ready" && message.scope.kind === "navigation",
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
                scopes: [{ scope: { kind: "navigation" } }],
              }),
            ),
          );
          socket.on("message", (frame) => {
            const parsed = readMessage(frame.toString());
            if (Option.isNone(parsed)) return reject(new Error("Invalid Core navigation delivery"));
            if (parsed.value.type === "scope-error") return reject(new Error(parsed.value.code));
            if (ready(parsed.value)) resolve();
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
  zeropsHttp: { baseUrl: string; world: FakeWorld },
  timings: HqTimings = {},
) {
  return startCore(true, {
    zeropsHttp,
    pingEvery: Duration.millis(timings.pingEvery ?? 20_000),
    reconcileEvery: Duration.millis(timings.reconcileEvery ?? 60_000),
    streamRecheck: Duration.millis(timings.streamRecheck ?? 30_000),
  });
}
