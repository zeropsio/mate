/**
 * Fork side of MD-16 (spec-mate.md §2.8, §2.9): every flag `mate.ServeArgv`
 * passes belongs to contract 1's flag list. The zcp side asserts the same
 * literal list against its own `ServeArgv`; this test asserts `serve --help`
 * still advertises each one, so a flag renamed or removed here without a
 * contract bump fails CI instead of crash-looping a container.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { cli } from "../src/bin.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

/** spec-mate.md §2.8 C-2, §2.2 — the flag set `ServeArgv` may pass. */
const CONTRACT_1_SERVE_FLAGS = [
  "--mode",
  "--host",
  "--port",
  "--base-path",
  "--base-dir",
  "--no-browser",
  "--auto-bootstrap-project-from-cwd",
] as const;

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* effect;
    const lines = yield* TestConsole.logLines;
    return lines.filter((line): line is string => typeof line === "string").join("\n");
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

describe("serve --help advertises contract 1", () => {
  it.effect.each(CONTRACT_1_SERVE_FLAGS)("advertises %s", (flag) =>
    Effect.gen(function* () {
      const output = yield* captureStdout(
        Command.runWith(cli, { version: "0.0.0" })(["serve", "--help"]),
      );
      expect(output).toContain(flag);
    }),
  );
});
