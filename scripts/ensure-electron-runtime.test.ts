// @effect-diagnostics nodeBuiltinImport:off -- isolated runtime repair subprocesses.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it("concurrent lanes share one verified host runtime, and workspace symlinks remain safe", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-electron-test-"));
  const runtime = NodePath.join(root, "runtime");
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Subprocess fixture exercises the actual host extractor.
  const hostPlatform = NodeOS.platform();
  const platformPath =
    hostPlatform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron";
  try {
    const contents = NodePath.join(root, "archive");
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(contents, platformPath)), { recursive: true });
    NodeFS.copyFileSync("/bin/ls", NodePath.join(contents, platformPath));
    NodeFS.writeFileSync(NodePath.join(contents, "version"), "1.0.0");
    if (hostPlatform === "darwin") {
      NodeFS.writeFileSync(NodePath.join(contents, "Electron.app/Contents/Info.plist"), "fixture");
      const framework = NodePath.join(
        contents,
        "Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
      );
      NodeFS.mkdirSync(NodePath.dirname(framework), { recursive: true });
      NodeFS.copyFileSync("/bin/ls", framework);
    }
    const zip = NodePath.join(root, "runtime.zip");
    const compressed = NodeChildProcess.spawnSync(
      "python3",
      [
        "-c",
        "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])",
        NodePath.join(root, "runtime"),
        contents,
      ],
      { encoding: "utf8" },
    );
    expect(compressed.status, compressed.stderr).toBe(0);
    NodeFS.mkdirSync(NodePath.join(runtime, "node_modules/@electron/get"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(runtime, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Fixture archive matches the actual host.
    const hostArch = NodeOS.arch();
    NodeFS.writeFileSync(
      NodePath.join(runtime, "checksums.json"),
      JSON.stringify({
        [`electron-v1.0.0-${hostPlatform}-${hostArch}.zip`]: NodeCrypto.createHash("sha256")
          .update(NodeFS.readFileSync(zip))
          .digest("hex"),
      }),
    );
    const counter = NodePath.join(root, "installs");
    NodeFS.writeFileSync(
      NodePath.join(runtime, "node_modules/@electron/get/index.js"),
      `exports.downloadArtifact = async (options) => { if (!options.downloader) throw new Error('offline required'); require('fs').appendFileSync(${JSON.stringify(counter)}, 'install\\n'); return ${JSON.stringify(zip)}; };`,
    );
    const otherRuntime = NodePath.join(root, "other-runtime");
    NodeFS.cpSync(runtime, otherRuntime, { recursive: true });
    const scripts = ["lane-a", "lane-b", "lane-c"].map((lane) => {
      const directory = NodePath.join(root, lane);
      NodeFS.mkdirSync(NodePath.join(directory, "node_modules"), { recursive: true });
      NodeFS.symlinkSync(
        lane === "lane-c" ? otherRuntime : runtime,
        NodePath.join(directory, "node_modules/electron"),
        "dir",
      );
      const script = NodePath.join(directory, "ensure.mjs");
      NodeFS.copyFileSync(
        NodePath.resolve(
          import.meta.dirname,
          "../apps/desktop/scripts/ensure-electron-runtime.mjs",
        ),
        script,
      );
      return script;
    });
    const imported = NodeChildProcess.spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(scripts[0])}); console.log('module ready');`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout.trim()).toBe("module ready");
    expect(NodeFS.existsSync(counter)).toBe(false);
    const run = (script: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = NodeChildProcess.spawn(process.execPath, [script, "--offline"], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, MATE_ELECTRON_CACHE: NodePath.join(root, "host-cache") },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
      });
    const results = await Promise.all(scripts.map(run));
    for (const [index, result] of results.entries()) {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(
        NodePath.join(index === 2 ? otherRuntime : runtime, "dist", platformPath),
      );
    }
    expect(NodeFS.readFileSync(counter, "utf8")).toBe("install\n");
    // A new worktree uses the host runtime even after the archive is no longer available.
    NodeFS.rmSync(zip);
    NodeFS.rmSync(NodePath.join(otherRuntime, "dist"), { recursive: true });
    const reused = await run(scripts[2]!);
    expect(reused.code, reused.stderr).toBe(0);
    expect(NodeFS.readFileSync(counter, "utf8")).toBe("install\n");
    expect(NodeFS.readFileSync(NodePath.join(otherRuntime, "dist/version"), "utf8")).toBe("1.0.0");
    expect(NodeFS.readFileSync(NodePath.join(runtime, "path.txt"), "utf8")).toBe(platformPath);
    expect(NodeFS.existsSync(NodePath.join(runtime, "dist", platformPath))).toBe(true);
    expect(NodeFS.readdirSync(runtime).some((file) => file.startsWith(".runtime-stage-"))).toBe(
      false,
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
