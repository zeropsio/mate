// @effect-diagnostics nodeBuiltinImport:off -- the consumer reads a real disposable ref.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { deliverRef, pushEvidenceForWire } from "./gitPush.ts";
import { HqPushOutcome } from "@t3tools/shared/hqDeploys";
import * as Schema from "effect/Schema";

const decodeOutcome = Schema.decodeUnknownSync(HqPushOutcome);

it.live("A push that finds the branch already at its commit ends pushed, as found.", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-push-found-")),
    );
    const exec = NodeUtil.promisify(NodeChildProcess.execFile);
    const git = async (args: string[]) =>
      (await exec("git", args, { cwd: directory })).stdout.trim();
    try {
      yield* Effect.promise(() => git(["init", "--bare", "remote.git"]));
      yield* Effect.promise(() => git(["init", "."]));
      yield* Effect.promise(() =>
        git([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.test",
          "commit",
          "--allow-empty",
          "-m",
          "Found",
        ]),
      );
      const sha = yield* Effect.promise(() => git(["rev-parse", "HEAD"]));
      const url = NodePath.join(directory, "remote.git");
      yield* Effect.promise(() => git(["push", url, `${sha}:refs/heads/main`]));
      const result = yield* deliverRef({
        directory,
        url,
        ref: "refs/heads/main",
        sha,
        identity: "local",
        token: Redacted.make("marker"),
        keptAt: "2026-10-13T00:00:00Z",
        confirmed: null,
      });
      expect(result.state).toBe("pushed");
      expect(result.evidence.via).toBe("found");
      expect(result.evidence.before).toBe(sha);
      expect(result.evidence.after).toBe(sha);
      expect(result.evidence.witness).toBeUndefined();
      expect(
        yield* Effect.promise(() => git(["--git-dir=remote.git", "rev-parse", "refs/heads/main"])),
      ).toBe(sha);
      // The wire reader consumes the same verdict without child handles or secret custody.
      const evidence = pushEvidenceForWire({
        ...result.evidence,
        remote: "https://github.com/example/repo.git",
      });
      const outcome = decodeOutcome({
        kind: "push",
        environment: "production",
        service: "code",
        sha,
        state: result.state,
        job: "1",
        processId: null,
        behind: null,
        reason: null,
        evidence,
      });
      expect(outcome.evidence?.confirmed?.after).toBe(sha);
      expect(outcome.evidence?.confirmed?.via).toBe("found");
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
    }
  }),
);
