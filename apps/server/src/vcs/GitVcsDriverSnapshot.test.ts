// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { it } from "@effect/vitest";
import { CheckpointRef } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vite-plus/test";

import { SNAPSHOT_SCRIPT, makeSnapshotOperations } from "./GitVcsDriverSnapshot.ts";

it("workspace capture runs on any runtime image with POSIX sh and git", () => {
  // The same fixture runs directly under BusyBox sh on an Alpine service.
  const result = NodeChildProcess.spawnSync(
    "sh",
    [NodeURL.fileURLToPath(new URL("./fixtures/snapshot-posix.sh", import.meta.url))],
    { env: { ...process.env, SNAPSHOT_SCRIPT }, encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("POSIX snapshot assertions passed\n");
});

const refused = (line: string) => ({
  exitCode: 1 as never,
  stdout: "",
  stderr: `${line}\n`,
  stdoutTruncated: false,
  stderrTruncated: false,
});
const captured = {
  exitCode: 0 as never,
  stdout: `${"a".repeat(40)}\ncaptured\n`,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
};
const input = {
  cwd: "/var/www/app",
  checkpointRef: CheckpointRef.make("refs/t3/checkpoints/t/runs/r/before"),
};

// Helpers working in the background build and test: a file of theirs can appear, grow or vanish
// while the capture looks at it. A moment later the tree has usually settled.
const capturing = (answers: Array<ReturnType<typeof refused> | typeof captured>) =>
  Effect.gen(function* () {
    let executed = 0;
    const { captureSnapshot } = makeSnapshotOperations(() => {
      executed += 1;
      return Effect.succeed(answers.length > 1 ? answers.shift()! : answers[0]!);
    });
    const fiber = yield* Effect.forkChild(Effect.result(captureSnapshot(input)));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(5));
    return { result: yield* Fiber.join(fiber), executed: () => executed };
  }).pipe(Effect.provide(TestClock.layer()));

it.effect.each([
  ["Snapshot refused: candidate validation failed", 2, true],
  ["Snapshot refused: inspection stopped at build/out.tmp", 2, true],
  ["Snapshot refused: candidate changed type: build/out.bin", 2, true],
  ["Snapshot refused: unsupported symlink: link", 1, false],
  [
    "Snapshot refused: file byte limit: big.bin\nSnapshot refused: candidate validation failed",
    1,
    false,
  ],
] as const)(
  "a capture refused with %s is looked at again only when a file changing under it can explain it",
  ([line, calls, capturedInTheEnd]) =>
    Effect.gen(function* () {
      const { result, executed } = yield* capturing([refused(line), captured]);
      expect(executed()).toBe(calls);
      expect(Result.isSuccess(result)).toBe(capturedInTheEnd);
    }),
);

it.effect("a capture still refused after its tries says why", () =>
  Effect.gen(function* () {
    const { result, executed } = yield* capturing([
      refused("Snapshot refused: candidate validation failed"),
    ]);
    expect(executed()).toBe(3);
    expect(Result.isFailure(result) && result.failure.message).toContain(
      "Snapshot refused: candidate validation failed",
    );
  }),
);
