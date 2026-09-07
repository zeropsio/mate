// @effect-diagnostics nodeBuiltinImport:off - real shell/Git fixtures verify the remote POSIX boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  decodeWorkspaceProbe,
  makeZeropsWorkspaceObserver,
  workspaceProbeScript,
  workspaceRootId,
} from "./ZeropsWorkspaceObserver.ts";
import { identityGuard } from "./ZeropsWorkspaceAccess.ts";

const repository = { host: "app", mountPath: "/var/www/app", remotePath: "/var/www" };
const output = (...fields: string[]) => fields.join("\0") + "\0";
const probeOutput = (projectId = "p", serviceId = "s") =>
  output(projectId, serviceId, "absent", "false", "", "", "", "");

describe("workspace identity observation", () => {
  it.effect("rejects a replacement service at the same hostname", () =>
    Effect.gen(function* () {
      const observer = makeZeropsWorkspaceObserver({
        projectId: "p",
        runProbe: () => Effect.succeed(probeOutput("p", "new")),
      });
      const result = yield* observer.observe({
        ...repository,
        identity: { projectId: "p", serviceId: "old" },
      });
      assert.strictEqual(result._tag, "unavailable");
    }),
  );
  it.effect("retains a Gitless directory as an available verified working root", () =>
    Effect.gen(function* () {
      const observer = makeZeropsWorkspaceObserver({
        projectId: "p",
        runProbe: () => Effect.succeed(probeOutput()),
      });
      const result = yield* observer.observe(repository);
      assert.strictEqual(result._tag, "available");
      if (result._tag !== "available") return;
      assert.strictEqual(result.git.state, "absent");
      assert.strictEqual(result.repository.rootId, workspaceRootId("p", "s", "/var/www"));
    }),
  );
  it.effect("rejects foreign projects and malformed observations", () =>
    Effect.gen(function* () {
      for (const raw of [probeOutput("other"), "banner\n" + probeOutput(), "p\0s\0"]) {
        const observer = makeZeropsWorkspaceObserver({
          projectId: "p",
          runProbe: () => Effect.succeed(raw),
        });
        assert.strictEqual((yield* observer.observe(repository))._tag, "unavailable");
      }
    }),
  );
  it("checks identity before the subsequent command can write", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-identity-"));
    try {
      const marker = NodePath.join(root, "marker");
      assert.throws(() =>
        NodeChildProcess.execFileSync(
          "sh",
          ["-c", identityGuard({ projectId: "p", serviceId: "expected" }) + `touch '${marker}'`],
          {
            env: { ...process.env, projectId: "p", serviceId: "replacement" },
            stdio: "pipe",
          },
        ),
      );
      assert.throws(() => NodeFS.readFileSync(marker));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("read-only portable shell probe on real repositories", () => {
  it("observes absent, dirty unborn and detached shallow states without normalizing Git", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-observe-"));
    const env = { ...process.env, projectId: "p", serviceId: "s" };
    const probe = () =>
      decodeWorkspaceProbe(
        NodeChildProcess.execFileSync("sh", ["-c", workspaceProbeScript(root)], {
          env,
          encoding: "utf8",
        }),
      );
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    try {
      NodeFS.writeFileSync(NodePath.join(root, "existing.txt"), "existing artifact or source\n");
      assert.strictEqual(probe()[2], "absent");
      assert.throws(() => NodeFS.readFileSync(NodePath.join(root, ".git", "HEAD")));
      git("init", "-q", "-b", "main");
      git("add", "existing.txt");
      const beforeIndex = NodeFS.readFileSync(NodePath.join(root, ".git", "index"));
      const beforeConfig = NodeFS.readFileSync(NodePath.join(root, ".git", "config"));
      const unborn = probe();
      assert.strictEqual(unborn[2], "unborn");
      assert.strictEqual(unborn[5], "main");
      assert.deepStrictEqual(
        NodeFS.readFileSync(NodePath.join(root, ".git", "index")),
        beforeIndex,
      );
      assert.deepStrictEqual(
        NodeFS.readFileSync(NodePath.join(root, ".git", "config")),
        beforeConfig,
      );
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "initial",
      );
      const head = git("rev-parse", "HEAD");
      git("checkout", "--detach", "-q");
      NodeFS.writeFileSync(NodePath.join(root, ".git", "shallow"), head + "\n");
      NodeFS.writeFileSync(NodePath.join(root, "existing.txt"), "dirty\n");
      const ready = probe();
      assert.strictEqual(ready[2], "ready");
      assert.strictEqual(ready[3], "true");
      assert.strictEqual(ready[4], head);
      assert.strictEqual(ready[5], "");
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(root, "existing.txt"), "utf8"),
        "dirty\n",
      );
      assert.strictEqual(git("rev-parse", "HEAD"), head);
      git("config", "remote.origin.promisor", "true");
      assert.strictEqual(probe()[2], "unsupported");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
