// @effect-diagnostics nodeBuiltinImport:off -- verify test discovery with disposable worktree copies.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it("does not collect private worktree copies as workspace tests", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-test-discovery-"));
  const repository = NodePath.resolve(import.meta.dirname, "..");
  try {
    for (const file of [
      "scripts/real.test.ts",
      ".plans/worktree/packages/shared/copy.test.ts",
      ".claude/worktrees/lane/packages/shared/copy.test.ts",
    ]) {
      const target = NodePath.join(root, file);
      NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
      NodeFS.writeFileSync(target, "export {};");
    }
    const output = NodeChildProcess.execFileSync(
      NodePath.join(repository, "node_modules/.bin/vp"),
      [
        "test",
        "list",
        "--filesOnly",
        "--root",
        root,
        "--config",
        NodePath.join(repository, "vite.config.ts"),
      ],
      { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(output).toContain("scripts/real.test.ts");
    expect(output).not.toContain("copy.test.ts");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
