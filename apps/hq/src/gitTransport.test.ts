// @effect-diagnostics nodeBuiltinImport:off -- exercise the real Git credential consumer.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { remoteIdentity } from "./gitTransport.ts";
import { withGitCredential } from "./gitAskpass.ts";

describe("remote identity", () => {
  it("Canonical repository identity is independent of credential guidance links.", () => {
    assert.deepStrictEqual(remoteIdentity("https://GitHub.com/Owner/Repo.git/"), {
      kind: "github",
      host: "github.com",
      path: "owner/repo",
      url: "https://github.com/owner/repo.git",
      key: "github.com/owner/repo",
    });
    assert.strictEqual(remoteIdentity("https://gitlab.example/Group/Sub/Repo.git")?.kind, "gitlab");
    assert.strictEqual(
      remoteIdentity("https://forge.example/Team/Repo.git")?.key,
      "forge.example/Team/Repo",
    );
  });
  it.each([
    "http://github.com/a/b",
    "ssh://git@github.com/a/b",
    "https://user:secret@github.com/a/b",
    "https://github.com/a/b?token=secret",
    "https://github.com/a/b#secret",
    "https://github.com/a",
    "https://github.com/a/b/c",
    "https://github.com/a/%2e%2e/b",
    "https://github.com/a/b%2fsecret",
    "https://github.com:444/a/b",
  ])("A credential or unsupported address never becomes a remote: %s", (url) =>
    assert.strictEqual(remoteIdentity(url), undefined),
  );
});

describe("Git token custody", () => {
  it.effect(
    "Git reads its token through askpass, never argv, URL or environment, and scope cleanup removes it.",
    () =>
      Effect.gen(function* () {
        const value = "askpass-test-credential";
        let path = "";
        const answer = yield* withGitCredential(Redacted.make(value), ({ args, env }) =>
          Effect.promise(async () => {
            path = env.GIT_ASKPASS;
            assert.notInclude(JSON.stringify({ args, env }), value);
            const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
              const child = NodeChildProcess.execFile(
                "git",
                [...args, "credential", "fill"],
                {
                  env: { ...process.env, ...env },
                  timeout: 5_000,
                },
                (error, stdout) => (error ? reject(error) : resolve({ stdout })),
              );
              child.stdin!.end("protocol=https\nhost=github.com\npath=owner/repo.git\n\n");
            });
            assert.include(stdout, `password=${value}`);
            assert.include(stdout, "username=x-access-token");
            const mode =
              (await NodeFSP.stat(path.replace(/askpass.cjs$/u, "credential"))).mode & 0o777;
            assert.strictEqual(mode, 0o600);
            return "consumed";
          }),
        );
        assert.strictEqual(answer, "consumed");
        assert.strictEqual(
          yield* Effect.promise(() =>
            NodeFSP.access(path).then(
              () => true,
              () => false,
            ),
          ),
          false,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
