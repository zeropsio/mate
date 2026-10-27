// @effect-diagnostics nodeBuiltinImport:off - the stand-in zcp logs its calls to a scratch file.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { testTempDir } from "../testing/testTempDir.ts";
import * as ZeropsCli from "./ZeropsCli.ts";

const liveDependencies = Layer.mergeAll(
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
);

type CliService = ZeropsCli.ZeropsCli["Service"];
type CliEffect = ReturnType<typeof ZeropsCli.make>;

/** A stand-in for the `zcp` binary: `node -e <script>` ignores the mate-status/mate-update args ZeropsCli passes. */
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

  it.effect("omits --refresh by default", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stderr.write(process.argv.slice(1).join(" ")); process.exit(1)`),
        (cli) => Effect.flip(cli.mateStatus()),
      );
      expect(String((error as { reason?: string }).reason)).not.toContain("--refresh");
    }),
  );

  it.effect("appends --refresh when requested", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stderr.write(process.argv.slice(1).join(" ")); process.exit(1)`),
        (cli) => Effect.flip(cli.mateStatus({ refresh: true })),
      );
      expect(String((error as { reason?: string }).reason)).toContain("--refresh");
    }),
  );
});

describe("ZeropsCli.mateStatus reads zcp's own reading", () => {
  it.effect.each([
    {
      name: "a status naming zcp behind and a restart carries both",
      line: '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z","zcp":{"installed":"9.225.0","latest":"9.226.0","behind":true},"restartNeeded":true,"why":"zcp 9.226.0 is out"}',
      expected: {
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restartNeeded: true,
        why: "zcp 9.226.0 is out",
      },
    },
    {
      name: "a status from an older zcp carries none of them",
      line: '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z"}',
      expected: { zcp: undefined, restartNeeded: undefined, why: undefined },
    },
  ])("$name", ({ line, expected }) =>
    Effect.gen(function* () {
      const result = yield* run(stub(`process.stdout.write(${JSON.stringify(line)})`), (cli) =>
        cli.mateStatus(),
      );
      expect({ zcp: result.zcp, restartNeeded: result.restartNeeded, why: result.why }).toEqual(
        expected,
      );
    }),
  );
});

describe("ZeropsCli.selfRestart", () => {
  const calls = () => NodePath.join(testTempDir("zcp-calls-"), "calls");
  const restart = (script: string, file?: string): CliEffect =>
    ZeropsCli.make({
      command: process.execPath,
      baseArgs: [
        "-e",
        `${file === undefined ? "" : `require("node:fs").appendFileSync(${JSON.stringify(file)}, process.argv.slice(1).join(" ") + "\\n");`} ${script}`,
      ],
      cwd: process.cwd(),
    });

  it.effect("asks zcp to restart its own service, and reads the platform's acceptance", () =>
    Effect.gen(function* () {
      const file = calls();
      const result = yield* run(
        restart(`process.stdout.write('{"processId":"proc-1"}')`, file),
        (cli) => cli.selfRestart,
      );
      expect(result).toEqual({ outcome: "accepted", process: "proc-1" });
      expect(NodeFS.readFileSync(file, "utf8").trim()).toBe("self restart --json");
    }),
  );

  it.effect.each([
    {
      name: "a restart the platform refused reads refused, in zcp's words",
      script: `process.stdout.write('{"error":"the project token may not restart zcp"}'); process.exit(1)`,
      reason: "the project token may not restart zcp",
    },
    {
      name: "a zcp without the verb reads refused, in a fixed phrase",
      script: `process.stderr.write("unknown command \\"self\\"\\n"); process.exit(2)`,
      reason: "this zcp can't restart its Mate yet",
    },
  ])("$name", ({ script, reason }) =>
    Effect.gen(function* () {
      const result = yield* run(restart(script), (cli) => cli.selfRestart);
      expect(result).toEqual({ outcome: "refused", reason });
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

  it.effect(
    "returns zcp's refusal, which names no versions, as the answer carrying its error",
    () =>
      Effect.gen(function* () {
        const result = yield* run(
          stub(
            `process.stdout.write('{"action":"none","restarted":false,"error":"ZCP_MATE_ENABLED is off"}'); process.exit(1)`,
          ),
          (cli) => cli.mateUpdate(),
        );
        expect(result).toEqual({
          action: "none",
          restarted: false,
          error: "ZCP_MATE_ENABLED is off",
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

describe("ZeropsCli.leaseRelease", () => {
  const branch = { branch: "feat-x", repo: "https://hq.example/git/app/web.git" };
  /**
   * A stand-in `zcp`: `version` prints `zcp v<version> (…)`, any other verb runs `release`; each
   * call's argv is appended to `calls` when given, one line per call.
   */
  const zcp = (input: {
    readonly release: string;
    readonly version?: string;
    readonly calls?: string;
    readonly timeoutMs?: number;
  }): CliEffect => {
    const log =
      input.calls === undefined
        ? ""
        : `require("node:fs").appendFileSync(${JSON.stringify(input.calls)}, process.argv.slice(1).join(" ") + "\\n");`;
    const version = JSON.stringify(`zcp v${input.version ?? "9.223.0"} (0869cf51a, 2026-10-27)\n`);
    return ZeropsCli.make({
      command: process.execPath,
      baseArgs: [
        "-e",
        `${log} if (process.argv[1] === "version") process.stdout.write(${version}); else { ${input.release} }`,
      ],
      cwd: process.cwd(),
      ...(input.timeoutMs === undefined ? {} : { leaseReleaseTimeout: input.timeoutMs }),
    });
  };
  const callsFile = () => NodePath.join(testTempDir("zcp-calls-"), "calls");
  const callsIn = (file: string): ReadonlyArray<string> =>
    NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8").trim().split("\n") : [];

  it.effect("asks zcp to release the branch's leases, never forced", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write(JSON.stringify({released:[{lease:"webpool-3",outcome:process.argv.slice(1).join(" ")}]}))`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "released",
        leases: [
          {
            lease: "webpool-3",
            outcome:
              "lease release --branch feat-x --repo https://hq.example/git/app/web.git --json",
          },
        ],
      });
    }),
  );

  it.effect("a branch zcp released reads released, with each lease's outcome", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write('{"released":[{"lease":"webpool-3","outcome":"kept-warm"},{"lease":"apipool-1","outcome":"removed"}]}')`,
        }),
        (cli) => cli.leaseRelease({ branch: "feat-x" }),
      );
      expect(result).toEqual({
        outcome: "released",
        leases: [
          { lease: "webpool-3", outcome: "kept-warm" },
          { lease: "apipool-1", outcome: "removed" },
        ],
      });
    }),
  );

  it.effect("a release zcp refused for unsaved work reads refused, naming what is unsaved", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write('{"refused":[{"lease":"webpool-3","unsaved":{"files":["src/app.ts"],"commits":["abc1234 wip"]}}]}'); process.exit(3)`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "refused",
        leases: [
          { lease: "webpool-3", unsaved: { files: ["src/app.ts"], commits: ["abc1234 wip"] } },
        ],
      });
    }),
  );

  it.effect(
    "a release zcp refused because another session uses a lease reads refused, naming how many",
    () =>
      Effect.gen(function* () {
        const result = yield* run(
          zcp({
            release: `process.stdout.write('{"refused":[{"lease":"apipool-1","inUse":{"sessions":2}}]}'); process.exit(3)`,
          }),
          (cli) => cli.leaseRelease(branch),
        );
        expect(result).toEqual({
          outcome: "refused",
          leases: [{ lease: "apipool-1", inUse: { sessions: 2 } }],
        });
      }),
  );

  it.effect("a release zcp could not make reads failed, in zcp's words", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write('{"error":"the pool did not answer"}'); process.exit(1)`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: "the pool did not answer" });
    }),
  );

  it.effect("a release zcp made only in part reads failed, naming the leases that went", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write('{"error":"the pool kept webpool-3","released":[{"lease":"apipool-1","outcome":"reset"},{"lease":"edgepool-1","outcome":"lost"}]}'); process.exit(1)`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "failed",
        reason: "the pool kept webpool-3",
        released: [
          { lease: "apipool-1", outcome: "reset" },
          { lease: "edgepool-1", outcome: "lost" },
        ],
      });
    }),
  );

  it.effect("a notice line before zcp's answer does not hide the answer", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdout.write('zcp v9.224.0 is available\\n{"released":[{"lease":"webpool-3","outcome":"removed"}]}\\n')`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "released",
        leases: [{ lease: "webpool-3", outcome: "removed" }],
      });
    }),
  );

  it.effect("a failed release keeps a fixed phrase, never what zcp wrote to stderr", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stderr.write("panic at /var/www/.zcp/state\\n"); process.exit(2)`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: "zcp gave no answer to read" });
    }),
  );

  // On the real clock: the bound is a real wait on a real process.
  it.live("a release zcp does not answer in time reads failed, and zcp is not waited on", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({ release: `setTimeout(() => {}, 10_000)`, timeoutMs: 200 }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "failed",
        reason: "zcp did not answer the release within 0.2 s",
      });
    }),
  );

  // An old zcp starts its MCP server on a verb it does not know, which waits on stdin for good.
  it.live("a zcp that reads its stdin is never left waiting on it", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          release: `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write('{"released":[]}'))`,
          timeoutMs: 5_000,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "released", leases: [] });
    }),
  );

  it.effect.each([
    { name: "an older release", version: "9.222.0" },
    { name: "a dev build of an older release", version: "9.219.0-818-g0869cf51a" },
    { name: "a build whose version cannot be read", version: "dev" },
  ])("a zcp of $name is never asked to release, and reads failed", ({ version }) =>
    Effect.gen(function* () {
      const calls = callsFile();
      const result = yield* run(
        zcp({ version, calls, release: `process.stdout.write('{"released":[]}')` }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: "this zcp can't release yet" });
      expect(callsIn(calls)).toEqual(["version"]);
    }),
  );

  it.effect("a zcp without the release command reads failed, never released", () =>
    Effect.gen(function* () {
      const result = yield* run(
        zcp({
          version: "9.222.0",
          release: `process.stderr.write("unknown command \\"lease\\"\\n"); process.exit(2)`,
        }),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: "this zcp can't release yet" });
    }),
  );

  it.effect("a zcp found able to release is not asked its version again", () =>
    Effect.gen(function* () {
      const calls = callsFile();
      yield* run(zcp({ calls, release: `process.stdout.write('{"released":[]}')` }), (cli) =>
        Effect.andThen(cli.leaseRelease(branch), cli.leaseRelease(branch)),
      );
      expect(callsIn(calls).map((line) => line.split(" ")[0])).toEqual([
        "version",
        "lease",
        "lease",
      ]);
    }),
  );

  it.effect("a container without zcp reads failed", () =>
    Effect.gen(function* () {
      const result = yield* run(missingBinary(), (cli) => cli.leaseRelease(branch));
      expect(result.outcome).toBe("failed");
    }),
  );
});
