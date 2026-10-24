import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as CrewShell from "./CrewShell.ts";
import {
  crewShellLayer,
  exists,
  git,
  makeServiceRepository,
  read,
  serviceRepository,
  TEST_HOST,
  TEST_IDENTITY,
  waitUntil,
  write,
} from "./testing/crewGitFixture.ts";

const withService = <A, E>(
  body: (root: string) => Effect.Effect<A, E, CrewShell.CrewShell>,
  options: Parameters<typeof crewShellLayer>[1] = {},
) =>
  Effect.gen(function* () {
    const root = makeServiceRepository();
    return yield* body(root).pipe(
      Effect.provide(crewShellLayer([serviceRepository(root)], options)),
    );
  });

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
    withService((root) =>
      Effect.gen(function* () {
        const shell = yield* CrewShell.CrewShell;
        const session = CrewShell.script(
          "echo + >> sessions.log; while [ ! -f sessions.release ]; do sleep 0.01; done; echo - >> sessions.log",
        );
        const sessions = yield* Effect.all(
          Array.from({ length: 5 }, () => shell.run(TEST_HOST, session, { timeout: "11 minutes" })),
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild);
        yield* waitUntil(
          () =>
            exists(root, "sessions.log") &&
            read(root, "sessions.log").trim().split("\n").length >=
              CrewShell.MAX_CREW_SESSIONS_PER_HOST,
        );
        write(root, "sessions.release", "release");
        yield* Fiber.join(sessions);
        let running = 0;
        let peak = 0;
        for (const mark of read(root, "sessions.log").trim().split("\n")) {
          running += mark === "+" ? 1 : -1;
          peak = Math.max(peak, running);
        }
        assert.strictEqual(peak, CrewShell.MAX_CREW_SESSIONS_PER_HOST);
      }),
    ),
  );

  it.effect("tells a missing repository directory from a script's own exit code", () =>
    Effect.gen(function* () {
      const root = makeServiceRepository();
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
