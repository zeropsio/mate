import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command } from "effect/cli";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestConsole from "effect/testing/TestConsole";

import { cli } from "../../bin.ts";
import { type CliServerFlags, resolveServerConfig } from "../../cli/config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { PersistedServerRuntimeState } from "../../serverRuntimeState.ts";
import * as ZeropsCli from "../ZeropsCli.ts";
import { make as makeMateUpdate } from "../ZeropsMateUpdate.ts";
import { type MateStatusResult, parseMateStatusOutput } from "../zeropsMateUpdateParse.ts";

const noFlags: CliServerFlags = {
  mode: Option.none(),
  port: Option.none(),
  host: Option.none(),
  basePath: Option.none(),
  baseDir: Option.none(),
  cwd: Option.none(),
  devUrl: Option.none(),
  zeropsFixtures: Option.none(),
  noBrowser: Option.none(),
  autoBootstrapProjectFromCwd: Option.none(),
  logWebSocketEvents: Option.none(),
};

/** What `resolveServerConfig` writes into the process's own environment. */
const PROCESS_ENV_KEYS = [
  "ZCP_MATE_STATE_FILE",
  "T3CODE_ZEROPS_HQ_ORIGIN",
  "T3CODE_ZEROPS_HQ_GIT_CREDENTIAL",
] as const;

/**
 * Resolves the server's configuration from flags and a literal environment, on an explicit port in
 * a scoped temporary base directory unless the flags name one, and puts back what it wrote into
 * `process.env`.
 */
const resolveIn = (
  flags: CliServerFlags,
  env: Record<string, string>,
  options?: Parameters<typeof resolveServerConfig>[2],
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = Option.isSome(flags.baseDir)
      ? flags.baseDir
      : Option.some(yield* fs.makeTempDirectoryScoped({ prefix: "mate-zc-" }));
    const saved = PROCESS_ENV_KEYS.map((key) => [key, process.env[key]] as const);
    return yield* resolveServerConfig(
      { ...flags, port: Option.some(3773), baseDir },
      Option.none(),
      options,
    ).pipe(
      Effect.provide(
        Layer.mergeAll(ConfigProvider.layer(ConfigProvider.fromEnv({ env })), NetService.layer),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }),
      ),
    );
  });

type ZcpAnswer =
  | { readonly stdout?: string; readonly stderr?: string; readonly code?: number }
  | ProcessRunner.ProcessSpawnError
  | ProcessRunner.ProcessTimeoutError;

const missingZcp = () =>
  new ProcessRunner.ProcessSpawnError({
    command: "zcp",
    argumentCount: 0,
    cause: Object.assign(new Error("spawn zcp ENOENT"), { code: "ENOENT" }),
  });

const ranOut = (answer: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}): ProcessRunner.ProcessRunOutput => ({
  stdout: answer.stdout ?? "",
  stderr: answer.stderr ?? "",
  code: ChildProcessSpawner.ExitCode(answer.code ?? 0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/**
 * A `ZeropsCli` over an in-process zcp: `version` prints `zcp v<version> (…)`, every other verb
 * gives the row's answer; each call's `args` and `stdin` are recorded.
 */
const zcpAnswering = (answer: ZcpAnswer, version = "9.223.0") => {
  const calls: Array<{ readonly args: ReadonlyArray<string>; readonly stdin?: string }> = [];
  const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.suspend(() => {
        calls.push({
          args: input.args,
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        });
        if (input.args[0] === "version")
          return Effect.succeed(ranOut({ stdout: `zcp v${version} (0869cf51a, 2026-10-27)\n` }));
        return "_tag" in answer ? Effect.fail(answer) : Effect.succeed(ranOut(answer));
      }),
  });
  return {
    calls,
    cli: ZeropsCli.make({ command: "zcp", baseArgs: [], cwd: "/var/www" }).pipe(
      Effect.provide(runner),
    ),
  };
};

const branch = { branch: "feat-x", repo: "https://hq.example/git/app/web.git" };

const STATUS_RESULT: MateStatusResult = {
  installed: "0.8.0",
  latest: "0.8.1",
  contract: 1,
  updateAvailable: true,
  checkedAt: "2026-09-09T00:00:00Z",
};

const stubCli = (
  mateStatus: (options?: {
    readonly local?: boolean;
  }) => Effect.Effect<MateStatusResult, ZeropsCli.ZeropsCliNotFound | ZeropsCli.ZeropsCliFailed>,
) => ({ mateStatus });

// witness: apps/server/src/cli/config.ts | export const basePathFlag = Flag.String("base-path").pipe( → export const basePathFlag = Flag.String("basepath").pipe(
it.effect(
  "ZC1: `mate serve --help` advertises every flag of zcp's launch contract: `--mode`, `--host`, `--port`, `--base-path`, `--base-dir`, `--no-browser` and `--auto-bootstrap-project-from-cwd`",
  () =>
    Effect.gen(function* () {
      yield* Command.runWith(cli, { version: "0.0.0" })(["serve", "--help"]);
      const output = (yield* TestConsole.logLines)
        .filter((line): line is string => typeof line === "string")
        .join("\n");
      for (const flag of [
        "--mode",
        "--host",
        "--port",
        "--base-path",
        "--base-dir",
        "--no-browser",
        "--auto-bootstrap-project-from-cwd",
      ]) {
        expect(output).toContain(flag);
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
      ),
    ),
);

// witness: apps/server/src/cli/config.ts | zeropsPublicOrigin: Config.String("zeropsSubdomain").pipe( → zeropsPublicOrigin: Config.String("T3CODE_ZEROPS_PUBLIC_ORIGIN").pipe(
it.effect(
  "ZC2: A Mate whose container zcp launched takes its public origin from the platform's `zeropsSubdomain`, with no variable set by hand",
  () =>
    Effect.gen(function* () {
      // What zcp's launch hands the server: the platform's live env store plus zcp's T3CODE_* file.
      const resolved = yield* resolveIn(noFlags, {
        T3CODE_ZEROPS_PROJECT_ID: "TEST000000000000000024",
        T3CODE_ZEROPS_API_HOST: "api.app-prg1.zerops.io",
        ZCP_API_KEY: "mate-key",
        serviceId: "TEST000000000000000025",
        hostname: "zcp",
        zeropsSubdomain: "https://zcp-3199-8080.prg1.zerops.app",
        zeropsSubdomainString: "https://zcp-3199-${port}.prg1.zerops.app",
      });
      expect(resolved.zerops?.publicOrigin).toBe("https://zcp-3199-8080.prg1.zerops.app");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/cli/config.ts | zeropsFixtures === undefined → zeropsFixtures === undefined || env.zeropsProjectId !== undefined
it.effect(
  "ZC3: Fixture mode, from `--zerops-fixtures` or `T3CODE_ZEROPS_FIXTURES`, keeps the Zerops identity door off even inside a Zerops project, the flag outranking the environment",
  () =>
    Effect.gen(function* () {
      const fromEnv = yield* resolveIn(noFlags, {
        T3CODE_ZEROPS_FIXTURES: "web:service-map-live",
      });
      expect(fromEnv.zeropsFixtures).toBe("web:service-map-live");
      expect(fromEnv.zerops).toBeUndefined();

      const inZerops = yield* resolveIn(noFlags, {
        T3CODE_ZEROPS_FIXTURES: "web:service-map-live",
        T3CODE_ZEROPS_PROJECT_ID: "project-that-must-not-enable-the-door",
      });
      expect(inZerops.zeropsFixtures).toBe("web:service-map-live");
      expect(inZerops.zerops).toBeUndefined();

      const flagWins = yield* resolveIn(
        { ...noFlags, zeropsFixtures: Option.some("web:agent-auth-ok") },
        { T3CODE_ZEROPS_FIXTURES: "web:service-map-live" },
      );
      expect(flagWins.zeropsFixtures).toBe("web:agent-auth-ok");
      expect(flagWins.zerops).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/cli/config.ts | resolveOptionPrecedence(normalizedFlags.basePath, Option.fromUndefinedOr(env.basePath)), → resolveOptionPrecedence(Option.fromUndefinedOr(env.basePath), normalizedFlags.basePath),
it.effect(
  "ZC4: The base path, from `--base-path` or `T3CODE_BASE_PATH`, reads with one leading slash and no trailing one, the flag winning, and empty when neither names one",
  () =>
    Effect.gen(function* () {
      const fromFlag = yield* resolveIn({ ...noFlags, basePath: Option.some("mate/") }, {});
      expect(fromFlag.basePath).toBe("/mate");

      const fromEnv = yield* resolveIn(noFlags, { T3CODE_BASE_PATH: "/mate/" });
      expect(fromEnv.basePath).toBe("/mate");

      const flagWins = yield* resolveIn(
        { ...noFlags, basePath: Option.some("/flag") },
        { T3CODE_BASE_PATH: "/env" },
      );
      expect(flagWins.basePath).toBe("/flag");

      const unset = yield* resolveIn(noFlags, {});
      expect(unset.basePath).toBe("");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/cli/config.ts | isHeadlessStartup ? Option.some(true) : Option.none(), → isHeadlessStartup ? Option.none() : Option.none(),
it.effect(
  "ZC5: `mate serve` never opens a browser and bootstraps a project from its working directory only on its own flag, whatever the environment says",
  () =>
    Effect.gen(function* () {
      const headless = yield* resolveIn(
        { ...noFlags, mode: Option.some("web") },
        { T3CODE_NO_BROWSER: "false", T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true" },
        { startupPresentation: "headless" },
      );
      expect(headless.noBrowser).toBe(true);
      expect(headless.startupPresentation).toBe("headless");
      expect(headless.autoBootstrapProjectFromCwd).toBe(false);

      // `serve`'s own options: headless, and opted out of bootstrapping unless its flag says so.
      const serveOptions = {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      } as const;
      const withFlag = yield* resolveIn(
        { ...noFlags, mode: Option.some("web"), autoBootstrapProjectFromCwd: Option.some(true) },
        {},
        serveOptions,
      );
      expect(withFlag.autoBootstrapProjectFromCwd).toBe(true);

      const withoutFlag = yield* resolveIn(
        { ...noFlags, mode: Option.some("web") },
        {},
        serveOptions,
      );
      expect(withoutFlag.autoBootstrapProjectFromCwd).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/cli/config.ts | zeropsCrew: Config.Boolean("T3CODE_ZEROPS_CREW").pipe(Config.withDefault(true)), → zeropsCrew: Config.Boolean("T3CODE_ZEROPS_CREW").pipe(Config.withDefault(false)),
it.effect("ZC6: Crew mode is on unless `T3CODE_ZEROPS_CREW` turns it off", () =>
  Effect.gen(function* () {
    for (const [env, expected] of [
      [{}, true],
      [{ T3CODE_ZEROPS_CREW: "false" }, false],
      [{ T3CODE_ZEROPS_CREW: "true" }, true],
    ] as const) {
      const resolved = yield* resolveIn(noFlags, env);
      expect(resolved.zeropsCrew).toBe(expected);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const encodeRuntimeState = Schema.encodeEffect(Schema.fromJsonString(PersistedServerRuntimeState));

// witness: apps/server/src/cli/config.ts | if (options?.rejectRunningServer && mode === "web") { → if (options?.rejectRunningServer) {
it.effect(
  "ZC7: A manual start over a live server's runtime record is refused before its working directory is made, while a stale record, a desktop start or the supervised `serve` goes on",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-zc-preflight-" });
      for (const [name, pid, mode, rejectRunningServer, expected] of [
        ["live", process.pid, "web", true, "Failure"],
        ["stale", 2_147_483_647, "web", true, "Success"],
        ["desktop", process.pid, "desktop", true, "Success"],
        ["serve", process.pid, "web", false, "Success"],
      ] as const) {
        const baseDir = path.join(root, name);
        const stateDir = path.join(baseDir, "userdata");
        yield* fs.makeDirectory(stateDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(stateDir, "server-runtime.json"),
          yield* encodeRuntimeState({
            version: 1,
            pid,
            port: 3773,
            origin: "http://127.0.0.1:3773",
            startedAt: "2026-10-01T00:00:00.000Z",
          }),
        );
        const cwd = path.join(root, `${name}-project`);
        const result = yield* resolveIn(
          {
            ...noFlags,
            mode: Option.some(mode),
            baseDir: Option.some(baseDir),
            cwd: Option.some(cwd),
          },
          {},
          { rejectRunningServer },
        ).pipe(Effect.result);
        expect(result._tag).toBe(expected);
        expect(yield* fs.exists(cwd)).toBe(expected === "Success");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") { → if (cause instanceof Error && "code" in cause && cause.code === "ENOTFOUND") {
it.effect(
  "ZC8: zcp's `mate status` is read from its stdout, an `error` field in it included, while a missing zcp reads not-found and a non-zero exit reads failed",
  () =>
    Effect.gen(function* () {
      const status = yield* zcpAnswering({
        stdout:
          '{"installed":"0.8.0","latest":"0.8.1","contract":1,"updateAvailable":true,"checkedAt":"2026-09-09T00:00:00Z"}',
      }).cli;
      expect(yield* status.mateStatus()).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        contract: 1,
        updateAvailable: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });

      const degraded = yield* zcpAnswering({
        stdout:
          '{"installed":"0.8.0","latest":"0.8.0","contract":1,"updateAvailable":false,"checkedAt":"2026-09-09T00:00:00Z","error":"manifest unreachable"}',
      }).cli;
      expect((yield* degraded.mateStatus()).error).toBe("manifest unreachable");

      const missing = yield* zcpAnswering(missingZcp()).cli;
      expect((yield* Effect.flip(missing.mateStatus()))._tag).toBe("ZeropsCliNotFound");

      const exited = yield* zcpAnswering({
        stderr: "mate status: not inside a Zerops container\n",
        code: 1,
      }).cli;
      expect((yield* Effect.flip(exited.mateStatus()))._tag).toBe("ZeropsCliFailed");
    }),
);

// witness: apps/server/src/zerops/zcpVersion.ts | export const zcpVersionText = (version: string): string => version.replace(/^v(?=\d)/u, ""); → export const zcpVersionText = (version: string): string => version;
it("ZC9: zcp's status relays its own version reading without a leading v, whether a restart is needed and why, and a status from an older zcp carries none of them", () => {
  for (const [line, expected] of [
    [
      '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z","zcp":{"installed":"9.225.0","latest":"9.226.0","behind":true},"restartNeeded":true,"why":"zcp 9.226.0 is out"}',
      {
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restartNeeded: true,
        why: "zcp 9.226.0 is out",
      },
    ],
    [
      '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z","zcp":{"installed":"v9.225.0","latest":"v9.226.0","behind":true},"restartNeeded":true,"why":"zcp v9.226.0 is out; a restart installs it"}',
      {
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restartNeeded: true,
        why: "zcp v9.226.0 is out; a restart installs it",
      },
    ],
    [
      '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z","zcp":{"installed":"v9.226.0","latest":"","behind":false},"restartNeeded":false}',
      {
        zcp: { installed: "9.226.0", latest: "", behind: false },
        restartNeeded: false,
        why: undefined,
      },
    ],
    [
      '{"installed":"0.14.0","latest":"0.16.1","contract":1,"updateAvailable":true,"checkedAt":"2026-10-27T00:00:00Z","zcp":{"installed":"v9.226.0","latest":"v9.226.0","behind":false},"restartNeeded":true,"why":"mate 0.14.0 has no updater; a restart installs mate 0.16.1"}',
      {
        zcp: { installed: "9.226.0", latest: "9.226.0", behind: false },
        restartNeeded: true,
        why: "mate 0.14.0 has no updater; a restart installs mate 0.16.1",
      },
    ],
    [
      '{"installed":"0.15.200","latest":"0.15.200","contract":1,"updateAvailable":false,"checkedAt":"2026-10-27T00:00:00Z"}',
      { zcp: undefined, restartNeeded: undefined, why: undefined },
    ],
  ] as const) {
    const result = parseMateStatusOutput(line);
    expect({ zcp: result?.zcp, restartNeeded: result?.restartNeeded, why: result?.why }).toEqual(
      expected,
    );
  }
});

// witness: apps/server/src/zerops/ZeropsCli.ts | const parsed = parseMateUpdateOutput(result.stdout); → const parsed = result.code === 0 ? parseMateUpdateOutput(result.stdout) : undefined;
it.effect(
  "ZC10: zcp's `mate update` answer is returned even on a non-zero exit, a refusal that names no versions included, while stdout that is no answer reads failed",
  () =>
    Effect.gen(function* () {
      // zcp's answer, or the tag of the error the call ended in.
      const answerOf = (cli: ZeropsCli.ZeropsCli["Service"]) =>
        Effect.match(cli.mateUpdate(), {
          onFailure: (error) => error._tag,
          onSuccess: (answer) => answer,
        });
      const updated = yield* zcpAnswering({
        stdout: '{"action":"updated","from":"0.8.0","to":"0.8.1","restarted":true}',
      }).cli;
      expect(yield* answerOf(updated)).toEqual({
        action: "updated",
        from: "0.8.0",
        to: "0.8.1",
        restarted: true,
      });

      const failed = yield* zcpAnswering({
        stdout:
          '{"action":"none","from":"0.8.0","to":"0.8.0","restarted":false,"error":"manifest unreachable"}',
        code: 1,
      }).cli;
      expect(yield* answerOf(failed)).toEqual({
        action: "none",
        from: "0.8.0",
        to: "0.8.0",
        restarted: false,
        error: "manifest unreachable",
      });

      const refused = yield* zcpAnswering({
        stdout: '{"action":"none","restarted":false,"error":"ZCP_MATE_ENABLED is off"}',
        code: 1,
      }).cli;
      expect(yield* answerOf(refused)).toEqual({
        action: "none",
        restarted: false,
        error: "ZCP_MATE_ENABLED is off",
      });

      const unreadable = yield* zcpAnswering({ stdout: "not json", code: 1 }).cli;
      expect(yield* answerOf(unreadable)).toBe("ZeropsCliFailed");
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | args: [...baseArgs, "lease", "release", ...args, "--json"], → args: [...baseArgs, "lease", "release", ...args, "--force", "--json"],
it.effect(
  "ZC11: zcp is asked to release a branch's leases as `lease release --branch` with the repository when one is named and `--json`, its stdin closed, never forced",
  () =>
    Effect.gen(function* () {
      const zcp = zcpAnswering({ stdout: '{"released":[]}' });
      const result = yield* (yield* zcp.cli).leaseRelease(branch);
      expect(result.outcome).toBe("released");
      expect(zcp.calls).toEqual([
        { args: ["version"], stdin: "" },
        {
          args: [
            "lease",
            "release",
            "--branch",
            "feat-x",
            "--repo",
            "https://hq.example/git/app/web.git",
            "--json",
          ],
          stdin: "",
        },
      ]);
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | : { outcome: "failed", reason: read.error, released: read.released }; → : releaseFailed(read.error);
it.effect(
  "ZC12: A release reads released with each lease's outcome on exit 0, refused on exit 3 naming each lease's unsaved files and commits or its other sessions, and failed in zcp's own error otherwise, naming the leases that went when only part was released",
  () =>
    Effect.gen(function* () {
      const released = yield* zcpAnswering({
        stdout:
          '{"released":[{"lease":"webpool-3","outcome":"kept-warm"},{"lease":"apipool-1","outcome":"removed"}]}',
      }).cli;
      expect(yield* released.leaseRelease({ branch: "feat-x" })).toEqual({
        outcome: "released",
        leases: [
          { lease: "webpool-3", outcome: "kept-warm" },
          { lease: "apipool-1", outcome: "removed" },
        ],
      });

      const unsaved = yield* zcpAnswering({
        stdout:
          '{"refused":[{"lease":"webpool-3","unsaved":{"files":["src/app.ts"],"commits":["abc1234 wip"]}}]}',
        code: 3,
      }).cli;
      expect(yield* unsaved.leaseRelease(branch)).toEqual({
        outcome: "refused",
        leases: [
          { lease: "webpool-3", unsaved: { files: ["src/app.ts"], commits: ["abc1234 wip"] } },
        ],
      });

      const inUse = yield* zcpAnswering({
        stdout: '{"refused":[{"lease":"apipool-1","inUse":{"sessions":2}}]}',
        code: 3,
      }).cli;
      expect(yield* inUse.leaseRelease(branch)).toEqual({
        outcome: "refused",
        leases: [{ lease: "apipool-1", inUse: { sessions: 2 } }],
      });

      const failed = yield* zcpAnswering({
        stdout: '{"error":"the pool did not answer"}',
        code: 1,
      }).cli;
      expect(yield* failed.leaseRelease(branch)).toEqual({
        outcome: "failed",
        reason: "the pool did not answer",
      });

      const partly = yield* zcpAnswering({
        stdout:
          '{"error":"the pool kept webpool-3","released":[{"lease":"apipool-1","outcome":"reset"},{"lease":"edgepool-1","outcome":"lost"}]}',
        code: 1,
      }).cli;
      expect(yield* partly.leaseRelease(branch)).toEqual({
        outcome: "failed",
        reason: "the pool kept webpool-3",
        released: [
          { lease: "apipool-1", outcome: "reset" },
          { lease: "edgepool-1", outcome: "lost" },
        ],
      });
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | const lines = stdout.split("\n"); → const lines = [stdout];
it.effect(
  "ZC13: zcp's answer is the last line of its stdout that reads as one, past any notice printed before it",
  () =>
    Effect.gen(function* () {
      const zcp = yield* zcpAnswering({
        stdout:
          'zcp v9.224.0 is available\n{"released":[{"lease":"webpool-3","outcome":"removed"}]}\n',
      }).cli;
      expect(yield* zcp.leaseRelease(branch)).toEqual({
        outcome: "released",
        leases: [{ lease: "webpool-3", outcome: "removed" }],
      });
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | return releaseFailed("zcp gave no answer to read"); → return releaseFailed(result.stderr);
it.effect("ZC14: A failed release never carries what zcp wrote to stderr", () =>
  Effect.gen(function* () {
    const zcp = yield* zcpAnswering({ stderr: "panic at /var/www/.zcp/state\n", code: 2 }).cli;
    const result = yield* zcp.leaseRelease(branch);
    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" ? result.reason : "").not.toContain(
      "panic at /var/www/.zcp/state",
    );
  }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | Effect.catch(Effect.succeed), → Effect.catch(Effect.die),
it.effect(
  "ZC15: A release zcp did not answer in time, or could not be run for, reads failed and is never an error",
  () =>
    Effect.gen(function* () {
      for (const answer of [
        new ProcessRunner.ProcessTimeoutError({ command: "zcp", argumentCount: 0, timeoutMs: 200 }),
        missingZcp(),
      ]) {
        const zcp = yield* zcpAnswering(answer).cli;
        const exit = yield* Effect.exit(zcp.leaseRelease(branch));
        expect(Exit.isSuccess(exit) ? exit.value.outcome : "not an answer").toBe("failed");
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | if (have === undefined || want === undefined) return false; → if (have === undefined || want === undefined) return true;
it.effect(
  "ZC16: A zcp older than the first release with `lease release`, a dev build of one, or one whose version cannot be read is asked only its version, never to release, and the release reads failed",
  () =>
    Effect.gen(function* () {
      for (const version of ["9.222.0", "9.219.0-818-g0869cf51a", "dev"]) {
        const zcp = zcpAnswering({ stdout: '{"released":[]}' }, version);
        const result = yield* (yield* zcp.cli).leaseRelease(branch);
        expect(result.outcome).toBe("failed");
        expect(zcp.calls.map((call) => call.args[0])).toEqual(["version"]);
      }

      const withoutRelease = yield* zcpAnswering(
        { stderr: 'unknown command "lease"\n', code: 2 },
        "9.222.0",
      ).cli;
      expect((yield* withoutRelease.leaseRelease(branch)).outcome).toBe("failed");
    }),
);

// witness: apps/server/src/zerops/ZeropsCli.ts | ? Effect.succeed(true) → ? Effect.map(version, (installed) => zcpAtLeast(installed, since))
it.effect("ZC17: A zcp once found able to release is not asked its version again", () =>
  Effect.gen(function* () {
    const zcp = zcpAnswering({ stdout: '{"released":[]}' });
    const cli = yield* zcp.cli;
    yield* cli.leaseRelease(branch);
    yield* cli.leaseRelease(branch);
    expect(zcp.calls.map((call) => call.args[0])).toEqual(["version", "lease", "lease"]);
  }),
);

// witness: apps/server/src/zerops/ZeropsMateUpdate.ts | const readLocal: Effect.Effect<void> = options.isZeropsEnvironment → const readLocal: Effect.Effect<void> = options.isZeropsEnvironment || true
it.effect(
  "ZC18: Outside a Zerops project the Mate's update line is absent and zcp is never asked; inside one it holds zcp's answer, and stays absent when zcp is missing",
  () =>
    Effect.gen(function* () {
      let called = false;
      const outside = yield* Effect.scoped(
        makeMateUpdate({
          cli: stubCli(() => {
            called = true;
            return Effect.succeed(STATUS_RESULT);
          }),
          isZeropsEnvironment: false,
        }),
      );
      expect(yield* outside.current).toBeUndefined();
      expect(called).toBe(false);

      const inside = yield* Effect.scoped(
        makeMateUpdate({
          cli: stubCli(() => Effect.succeed(STATUS_RESULT)),
          isZeropsEnvironment: true,
        }),
      );
      expect(yield* inside.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });

      const missing = yield* Effect.scoped(
        makeMateUpdate({
          cli: stubCli(() => Effect.fail(new ZeropsCli.ZeropsCliNotFound({ command: "zcp" }))),
          isZeropsEnvironment: true,
        }),
      );
      expect(yield* missing.current).toBeUndefined();
    }),
);

// witness: apps/server/src/zerops/ZeropsMateUpdate.ts | }).pipe(Effect.andThen(SubscriptionRef.get(state))), → }).pipe(Effect.as(undefined)),
it.effect("ZC19: A check that zcp fails keeps and returns the last good update line", () =>
  Effect.gen(function* () {
    let call = 0;
    const service = yield* Effect.scoped(
      makeMateUpdate({
        cli: stubCli(() => {
          call += 1;
          return call === 1
            ? Effect.succeed(STATUS_RESULT)
            : Effect.fail(new ZeropsCli.ZeropsCliFailed({ command: "zcp", reason: "timed out" }));
        }),
        isZeropsEnvironment: true,
      }),
    );
    const lastGood = {
      installed: "0.8.0",
      latest: "0.8.1",
      available: true,
      checkedAt: "2026-09-09T00:00:00Z",
    };
    expect(yield* service.current).toEqual(lastGood);
    expect(yield* service.check).toEqual(lastGood);
    expect(yield* service.current).toEqual(lastGood);
  }),
);

// witness: apps/server/src/zerops/ZeropsMateUpdate.ts | needed: status.restartNeeded, → needed: status.updateAvailable,
it.effect(
  "ZC20: The update line relays zcp's reading of itself and whether, and why, only a restart gets the Mate current",
  () =>
    Effect.gen(function* () {
      const service = yield* makeMateUpdate({
        cli: stubCli(() =>
          Effect.succeed({
            installed: "0.15.200",
            latest: "0.15.200",
            contract: 1,
            updateAvailable: false,
            checkedAt: "2026-10-27T00:00:00Z",
            updater: { protocol: 1, phase: "idle", runningVersion: "0.15.200" },
            zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
            restartNeeded: true,
            why: "zcp 9.226.0 is out; only a restart installs it",
          }),
        ),
        isZeropsEnvironment: true,
      });
      expect(yield* service.current).toMatchObject({
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restart: { needed: true, why: "zcp 9.226.0 is out; only a restart installs it" },
      });
    }).pipe(Effect.scoped),
);

// witness: packages/contracts/src/environment.ts | postponedSince: Schema.optionalKey(Schema.String), → postponedSinceDropped: Schema.optionalKey(Schema.String),
it.effect(
  "ZC21: A local re-read of zcp's status relays a postponed update with since, what for and why, and the update line publishes it",
  () =>
    Effect.gen(function* () {
      // zcp's postponed answer as it prints it, read through the one status decode.
      const postponed = yield* Effect.fromNullishOr(
        parseMateStatusOutput(
          JSON.stringify({
            installed: "0.8.0",
            latest: "0.8.1",
            contract: 1,
            updateAvailable: true,
            checkedAt: "2026-09-09T01:00:00Z",
            updater: {
              protocol: 1,
              phase: "postponed",
              runningVersion: "0.8.0",
              postponedSince: "2026-09-09T00:30:00Z",
              postponedFor: "0.8.1",
              postponedWhy: "a turn is running",
            },
          }),
        ),
      );
      const reads: Array<boolean | undefined> = [];
      const service = yield* makeMateUpdate({
        cli: stubCli((options) => {
          reads.push(options?.local);
          return Effect.succeed(reads.length === 1 ? STATUS_RESULT : postponed);
        }),
        isZeropsEnvironment: true,
      });
      const heard = yield* Stream.runCollect(Stream.take(service.changes, 2)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* service.readLocal;
      const relayed = {
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T01:00:00Z",
        automatic: {
          protocol: 1,
          phase: "postponed",
          runningVersion: "0.8.0",
          postponedSince: "2026-09-09T00:30:00Z",
          postponedFor: "0.8.1",
          postponedWhy: "a turn is running",
        },
      };
      expect(reads).toEqual([true, true]);
      expect(yield* service.current).toEqual(relayed);
      expect([...(yield* Fiber.join(heard))][1]).toEqual(relayed);
    }).pipe(Effect.scoped),
);
