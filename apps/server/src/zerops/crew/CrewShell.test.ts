// @effect-diagnostics nodeBuiltinImport:off - the fixture resets files between cases.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";

import * as CrewShell from "./CrewShell.ts";
import {
  crewShellLayer,
  exists,
  git,
  makeServiceRepository,
  serviceRepository,
  TEST_HOST,
  TEST_IDENTITY,
} from "./testing/crewGitFixture.ts";

const root = makeServiceRepository();
const initialCommit = git(root, ["rev-parse", "HEAD"]);

afterEach(() => {
  git(root, ["reset", "--hard", "-q", initialCommit]);
  NodeFS.rmSync(NodePath.join(root, "ran"), { force: true });
});

const withService = <A, E>(
  body: (root: string) => Effect.Effect<A, E, CrewShell.CrewShell>,
  options: Parameters<typeof crewShellLayer>[1] = {},
) => body(root).pipe(Effect.provide(crewShellLayer([serviceRepository(root)], options)));

describe("CrewShell", () => {
  it.effect("runs a script on the host with its cwd at the repository's remote path", () =>
    withService((root) =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const result = yield* shell.run(TEST_HOST, CrewShell.script("pwd -P"), {
          timeout: "11 minutes",
        });
        assert.deepStrictEqual(
          { code: result.code, stdout: result.stdout.trim(), timedOut: result.timedOut },
          { code: 0, stdout: root, timedOut: false },
        );
      }),
    ),
  );

  it.effect("refuses before running anything when the far side's identity differs", () =>
    withService(
      (root) =>
        Effect.gen(function* () {
          const shell = yield* CrewShell.CrewShell;
          const error = yield* shell
            .run(TEST_HOST, CrewShell.script("touch ran"), { timeout: "11 minutes" })
            .pipe(Effect.flip);
          assert.deepStrictEqual(
            { reason: error.reason, ran: exists(root, "ran") },
            { reason: "identity", ran: false },
          );
        }),
      { remoteEnv: { projectId: TEST_IDENTITY.projectId, serviceId: "another-service" } },
    ),
  );

  it.effect("refuses a host that has no verified binding", () =>
    withService(() =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const error = yield* shell
          .run("otherdev", CrewShell.script("true"), { timeout: "11 minutes" })
          .pipe(Effect.flip);
        assert.strictEqual(error.reason, "unverified");
      }),
    ),
  );

  it.effect("commits as the crew with the durable-write settings on every git line", () =>
    withService((root) =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const line = CrewShell.git("integration", ["commit", "-q", "--allow-empty", "-m", "x"]);
        const result = yield* shell.run(TEST_HOST, line, { timeout: "11 minutes" });
        assert.deepStrictEqual(
          {
            code: result.code,
            author: git(root, ["log", "-1", "--format=%an <%ae>"]),
            durable: ["core.fsync=objects,reference", "core.fsyncMethod=fsync"].every((setting) =>
              line.includes(setting),
            ),
          },
          { code: 0, author: "Zerops Mate Crew <crew@zerops.io>", durable: true },
        );
      }),
    ),
  );

  it.effect("reports a script the remote timeout stopped", () =>
    withService(() =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const result = yield* shell.run(
          TEST_HOST,
          CrewShell.script("exec node -e 'setInterval(() => {}, 1000)'"),
          {
            timeout: "1 second",
          },
        );
        assert.isTrue(result.timedOut);
      }),
    ),
  );

  it.effect("hands stdin to the script", () =>
    withService(() =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const result = yield* shell.run(TEST_HOST, CrewShell.script("cat"), {
          timeout: "11 minutes",
          stdin: "line one\nline two\n",
        });
        assert.strictEqual(result.stdout, "line one\nline two\n");
      }),
    ),
  );

  it.effect("runs at most three crew sessions on one host at a time", () =>
    Effect.gen(function* () {
      const running = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const threeEntered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const shell = CrewShell.makeCrewShell({
        known: Effect.succeed([serviceRepository(root)]),
        runner: {
          run: () =>
            Effect.gen(function* () {
              const current = yield* Ref.updateAndGet(running, (count) => count + 1);
              yield* Ref.update(peak, (count) => Math.max(count, current));
              if (current === 3) yield* Deferred.succeed(threeEntered, undefined);
              yield* Deferred.await(release);
              yield* Ref.update(running, (count) => count - 1);
              return {
                code: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            }),
        },
      });
      const sessions = yield* Effect.forEach(Array.from({ length: 5 }), () =>
        shell
          .run(TEST_HOST, CrewShell.script("true"), { timeout: "11 minutes" })
          .pipe(Effect.forkChild({ startImmediately: true })),
      );
      yield* Deferred.await(threeEntered);
      yield* TestClock.adjust(0);
      assert.strictEqual(yield* Ref.get(peak), 3);
      yield* Deferred.succeed(release, undefined);
      yield* Effect.forEach(sessions, Fiber.join);
      assert.strictEqual(yield* Ref.get(peak), 3);
    }),
  );

  it.effect("tells a missing repository directory from a script's own exit code", () =>
    Effect.gen(function* () {
      const missing = { ...serviceRepository(root), remotePath: `${root}/gone` };
      const outcomes = yield* Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const own = yield* shell.run(TEST_HOST, CrewShell.script("exit 125"), {
          timeout: "11 minutes",
        });
        return own.code;
      }).pipe(
        Effect.provide(crewShellLayer([serviceRepository(root)])),
        Effect.zip(
          Effect.gen(function* () {
            const shell = yield* CrewShell.CrewShell;
            const error = yield* shell
              .run(TEST_HOST, CrewShell.script("true"), { timeout: "11 minutes" })
              .pipe(Effect.flip);
            return error.reason;
          }).pipe(Effect.provide(crewShellLayer([missing]))),
        ),
      );
      assert.deepStrictEqual(outcomes, [125, "workspace"]);
    }),
  );
});
