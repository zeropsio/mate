import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ZeropsCli from "./ZeropsCli.ts";

const liveDependencies = Layer.mergeAll(
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
);

type CliService = ZeropsCli.ZeropsCli["Service"];
type CliEffect = ReturnType<typeof ZeropsCli.make>;

/** A stand-in for the `zcp` binary: `node -e <script>` ignores the mark-oauth args. */
const stub = (script: string): CliEffect =>
  ZeropsCli.make({ command: process.execPath, baseArgs: ["-e", script], cwd: process.cwd() });

const missingBinary = (): CliEffect =>
  ZeropsCli.make({
    command: "definitely-not-a-real-binary-zcp",
    baseArgs: [],
    cwd: process.cwd(),
  });

const run = <A, E>(cli: CliEffect, use: (cli: CliService) => Effect.Effect<A, E>) =>
  cli.pipe(Effect.flatMap(use), Effect.provide(liveDependencies));

describe("ZeropsCli.markAgentOAuth", () => {
  it.effect("parses the result the CLI prints on stdout", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"ok":true,"agent":"claude-code","key":"ZCP_AGENT_OAUTH_CLAUDE_CODE","changed":true}')`,
        ),
        (cli) => cli.markAgentOAuth("claude-code"),
      );
      expect(result).toEqual({
        key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
        changed: true,
        migrated: false,
      });
    }),
  );

  it.effect("reports a missing binary as not-found, distinct from a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) => Effect.flip(cli.markAgentOAuth("codex")));
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );

  it.effect("reports a non-zero exit as a failure carrying the diagnostic", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(
          `process.stderr.write("agent mark-oauth: not inside a Zerops container\\n"); process.exit(1)`,
        ),
        (cli) => Effect.flip(cli.markAgentOAuth("codex")),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
      expect(String((error as { reason?: string }).reason)).toContain(
        "not inside a Zerops container",
      );
    }),
  );

  it.effect("reports unreadable stdout as a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stdout.write("zcp: something went sideways")`),
        (cli) => Effect.flip(cli.markAgentOAuth("codex")),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
    }),
  );
});
