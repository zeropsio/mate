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

describe("ZeropsCli.mateStatus", () => {
  it.effect("parses the result the CLI prints on stdout", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"installed":"0.8.0","latest":"0.8.1","contract":1,"updateAvailable":true,"checkedAt":"2026-09-09T00:00:00Z"}')`,
        ),
        (cli) => cli.mateStatus(),
      );
      expect(result).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        contract: 1,
        updateAvailable: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect("tolerates an error field in an otherwise valid answer", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"installed":"0.8.0","latest":"0.8.0","contract":1,"updateAvailable":false,"checkedAt":"2026-09-09T00:00:00Z","error":"manifest unreachable"}')`,
        ),
        (cli) => cli.mateStatus(),
      );
      expect(result.error).toBe("manifest unreachable");
    }),
  );

  it.effect("reports a missing binary as not-found, distinct from a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) => Effect.flip(cli.mateStatus()));
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );

  it.effect("reports a non-zero exit as a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(
          `process.stderr.write("mate status: not inside a Zerops container\\n"); process.exit(1)`,
        ),
        (cli) => Effect.flip(cli.mateStatus()),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
    }),
  );
});

describe("ZeropsCli.mateUpdate", () => {
  it.effect("parses the result the CLI prints on stdout", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"action":"updated","from":"0.8.0","to":"0.8.1","restarted":true}')`,
        ),
        (cli) => cli.mateUpdate(),
      );
      expect(result).toEqual({
        action: "updated",
        from: "0.8.0",
        to: "0.8.1",
        restarted: true,
      });
    }),
  );

  it.effect("returns the JSON even on a non-zero exit, never a transport error (MU-2)", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"action":"none","from":"0.8.0","to":"0.8.0","restarted":false,"error":"manifest unreachable"}'); process.exit(1)`,
        ),
        (cli) => cli.mateUpdate(),
      );
      expect(result).toEqual({
        action: "none",
        from: "0.8.0",
        to: "0.8.0",
        restarted: false,
        error: "manifest unreachable",
      });
    }),
  );

  it.effect("reports a missing binary as not-found, distinct from a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) => Effect.flip(cli.mateUpdate()));
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );

  it.effect("reports unreadable stdout as a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(stub(`process.stdout.write("not json"); process.exit(1)`), (cli) =>
        Effect.flip(cli.mateUpdate()),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
    }),
  );
});
