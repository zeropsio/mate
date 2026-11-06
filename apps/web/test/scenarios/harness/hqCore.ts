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
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { readHqRef } from "../../../../../scripts/hq-ref.ts";
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
  return Effect.gen(function* () {
    const command = process.env.MATE_HQ_TEST_COMMAND;
    if (!command)
      return yield* Effect.die(
        new Error(
          "Scenarios run against mate-hq's test HQ: set MATE_HQ_TEST_COMMAND to `node <mate-hq>/conformance/scripts/test-hq.ts`",
        ),
      );
    const root = NodeURL.fileURLToPath(new URL("../../../../../", import.meta.url));
    const expected = readHqRef(root);
    const core = yield* startExternalCore(command, zeropsHttp);
    const health = yield* core.call("GET", "/health");
    const actual =
      typeof health.body === "object" &&
      health.body !== null &&
      "commit" in health.body &&
      typeof health.body.commit === "string"
        ? health.body.commit
        : "unavailable";
    if (health.status !== 200 || actual !== expected)
      return yield* Effect.die(
        new Error(
          `mate-hq preflight: expected ${expected}, built HQ reports ${actual} (health ${health.status})`,
        ),
      );
    // The health receipt names a commit; a clean standard launcher proves those are the sources built.
    const launcher = /^node ([A-Za-z0-9_./-]+)$/u.exec(command)?.[1];
    if (
      !launcher ||
      !NodePath.isAbsolute(launcher) ||
      !launcher.endsWith("/conformance/scripts/test-hq.ts")
    )
      return yield* Effect.die(
        new Error("mate-hq preflight requires the standard absolute test-hq.ts launcher"),
      );
    const checkout = NodePath.resolve(NodePath.dirname(launcher), "../..");
    const git = (...args: string[]) =>
      NodeChildProcess.spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
    const head = git("rev-parse", "--verify", "HEAD^{commit}");
    const top = git("rev-parse", "--show-toplevel");
    const dirty = git("status", "--porcelain", "--untracked-files=normal");
    if (
      head.status !== 0 ||
      head.stdout.trim() !== expected ||
      top.status !== 0 ||
      NodeFS.realpathSync(top.stdout.trim()) !== NodeFS.realpathSync(checkout) ||
      dirty.status !== 0 ||
      dirty.stdout.trim() !== "" ||
      NodeFS.existsSync(NodePath.join(checkout, "COMMIT"))
    )
      return yield* Effect.die(
        new Error(
          `mate-hq preflight: expected clean checkout ${expected}, found ${head.stdout.trim() || "unavailable"} or uncommitted sources`,
        ),
      );
    return core;
  });
}

export type ScenarioCore = Effect.Success<ReturnType<typeof startScenarioCore>>;
