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
  const stubWithin = (script: string, timeoutMs: number): CliEffect =>
    ZeropsCli.make({
      command: process.execPath,
      baseArgs: ["-e", script],
      cwd: process.cwd(),
      leaseReleaseTimeout: timeoutMs,
    });

  it.effect("asks zcp to release the branch's leases, never forced", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write(JSON.stringify({released:[{lease:"webpool-3",outcome:process.argv.slice(1).join(" ")}]}))`,
        ),
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
        stub(
          `process.stdout.write('{"released":[{"lease":"webpool-3","outcome":"kept-warm"},{"lease":"apipool-1","outcome":"removed"}]}')`,
        ),
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
        stub(
          `process.stdout.write('{"refused":[{"lease":"webpool-3","unsaved":{"files":["src/app.ts"],"commits":["abc1234 wip"]}}]}'); process.exit(3)`,
        ),
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

  it.effect("a release zcp could not make reads failed, in zcp's words", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(`process.stdout.write('{"error":"the pool did not answer"}'); process.exit(1)`),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: "the pool did not answer" });
    }),
  );

  it.effect("a release zcp does not answer in time reads failed, and zcp is not waited on", () =>
    Effect.gen(function* () {
      const result = yield* run(stubWithin(`setTimeout(() => {}, 10_000)`, 200), (cli) =>
        cli.leaseRelease(branch),
      );
      expect(result).toEqual({
        outcome: "failed",
        reason: "zcp did not answer the release within 0.2 s",
      });
    }),
  );

  it.effect("a zcp without the release command reads failed, never released", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(`process.stderr.write("unknown command \\"lease\\"\\n"); process.exit(2)`),
        (cli) => cli.leaseRelease(branch),
      );
      expect(result).toEqual({ outcome: "failed", reason: 'unknown command "lease"' });
    }),
  );

  it.effect("a container without zcp reads failed", () =>
    Effect.gen(function* () {
      const result = yield* run(missingBinary(), (cli) => cli.leaseRelease(branch));
      expect(result.outcome).toBe("failed");
    }),
  );
});
