// @effect-diagnostics nodeBuiltinImport:off -- disposable Core loopback socket receipts.
import {
  hqScopeKey,
  HqStreamMessage,
  HqStreamRequest,
  HQ_PROTECTED_SCOPE_KINDS,
  type HqScope,
} from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WebSocket } from "ws";
import type { FakeWorld } from "./fakeWorld.ts";
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
  accessToken?: string,
) =>
  Effect.gen(function* () {
    const protectedScope = HQ_PROTECTED_SCOPE_KINDS.has(scope.kind);
    if (protectedScope && accessToken === undefined)
      return yield* Effect.die(new Error("A protected HQ scope needs its person's access token"));
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
                ...(protectedScope && accessToken !== undefined ? { accessToken } : {}),
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

export function startScenarioCore(zeropsHttp: {
  baseUrl: string;
  world: FakeWorld;
  github?: GithubAddress;
}) {
  return Effect.suspend(() => {
    const command = process.env.MATE_HQ_TEST_COMMAND;
    if (!command)
      return Effect.die(
        new Error(
          "Scenarios run against mate-hq's test HQ: set MATE_HQ_TEST_COMMAND to `node <mate-hq>/conformance/scripts/test-hq.ts`",
        ),
      );
    return startExternalCore(command, zeropsHttp);
  });
}

export type ScenarioCore = Effect.Success<ReturnType<typeof startScenarioCore>>;
