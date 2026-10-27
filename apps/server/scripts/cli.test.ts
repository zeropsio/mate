// @effect-diagnostics nodeBuiltinImport:off - invoke the release CLI against real isolated artifacts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";

it("packs a server-only release without a web bundle", () => {
  const source = NodeURL.fileURLToPath(new URL("../../..", import.meta.url));
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-server-pack-"));
  try {
    const server = NodePath.join(root, "apps/server");
    NodeFS.mkdirSync(NodePath.join(server, "dist"), { recursive: true });
    NodeFS.cpSync(NodePath.join(source, "apps/server/scripts"), NodePath.join(server, "scripts"), {
      recursive: true,
    });
    NodeFS.cpSync(NodePath.join(source, "scripts/lib"), NodePath.join(root, "scripts/lib"), {
      recursive: true,
    });
    for (const file of [
      "package.json",
      "pnpm-workspace.yaml",
      "apps/server/package.json",
      "apps/server/src/zerops/ZeropsEnvironment.ts",
    ]) {
      NodeFS.cpSync(NodePath.join(source, file), NodePath.join(root, file), { recursive: true });
    }
    NodeFS.symlinkSync(
      NodePath.join(source, "node_modules"),
      NodePath.join(root, "node_modules"),
      "dir",
    );
    NodeFS.symlinkSync(
      NodePath.join(source, "scripts/node_modules"),
      NodePath.join(root, "scripts/node_modules"),
      "dir",
    );
    NodeFS.symlinkSync(
      NodePath.join(source, "apps/server/node_modules"),
      NodePath.join(server, "node_modules"),
      "dir",
    );
    NodeFS.writeFileSync(
      NodePath.join(server, "dist/bin.mjs"),
      'console.log("server-only fixture");\n',
    );
    const originalManifest = NodeFS.readFileSync(NodePath.join(server, "package.json"), "utf8");
    const out = NodePath.join(root, "packed");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [NodePath.join(server, "scripts/cli.ts"), "pack", "--out", out],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    expect(
      result.status,
      `The release CLI must pack server artifacts without dist/client/index.html: ${result.stdout}${result.stderr}`,
    ).toBe(0);
    expect(NodeFS.readFileSync(NodePath.join(server, "package.json"), "utf8")).toBe(
      originalManifest,
    );
    const tarballs = NodeFS.readdirSync(out).filter((file) => file.endsWith(".tgz"));
    expect(tarballs).toHaveLength(1);
    const entries = NodeChildProcess.execFileSync(
      "tar",
      ["-tzf", NodePath.join(out, tarballs[0]!)],
      {
        encoding: "utf8",
      },
    ).split("\n");
    expect(entries).toContain("package/dist/bin.mjs");
    expect(entries.some((entry) => entry.startsWith("package/dist/client/"))).toBe(false);
    const manifest = JSON.parse(
      NodeChildProcess.execFileSync(
        "tar",
        ["-xOf", NodePath.join(out, tarballs[0]!), "package/package.json"],
        {
          encoding: "utf8",
        },
      ),
    );
    expect(manifest.name).toBe("zerops-mate");
    expect(manifest.bin).toEqual({ mate: "./dist/bin.mjs" });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
