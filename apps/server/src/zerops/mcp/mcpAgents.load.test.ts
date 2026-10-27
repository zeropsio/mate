// @effect-diagnostics nodeBuiltinImport:off - spawns Node and reads a temp bundle, no Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { build } from "vite-plus/pack";
import { describe, expect, it } from "vite-plus/test";

import serverConfig from "../../../vite.config.ts";

const MODULE = NodeURL.fileURLToPath(new URL("./mcpAgents.ts", import.meta.url));

describe("mcpAgents loading", () => {
  it("loads under Node's own ES module loader, as the dev server runs it", () => {
    const loaded = NodeChildProcess.spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(NodeURL.pathToFileURL(MODULE).href)});`,
      ],
      { encoding: "utf8" },
    );
    expect(loaded.stderr).toBe("");
    expect(loaded.status).toBe(0);
  });

  // The UMD wrapper requires its own files at run time; bundled, those requires
  // point beside dist/bin.mjs, where nothing is (release 0.12.0 failed to start).
  it("bundles jsonc-parser's ES build into the server bundle, never its UMD wrapper", async () => {
    const outDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mcp-agents-bundle-"));
    try {
      const pack = serverConfig.pack;
      if (pack === undefined || Array.isArray(pack)) throw new Error("server pack config missing");
      await build({
        config: false,
        entry: [MODULE],
        outDir,
        format: "esm",
        platform: "node",
        dts: false,
        sourcemap: false,
        logLevel: "silent",
        alias: pack.alias,
        deps: pack.deps,
      });
      const bundle = NodeFS.readdirSync(outDir)
        .filter((file) => file.endsWith(".mjs") || file.endsWith(".js"))
        .map((file) => NodeFS.readFileSync(NodePath.join(outDir, file), "utf8"))
        .join("\n");
      expect(bundle).toContain("function printParseErrorCode");
      expect(bundle).not.toMatch(/from ["']jsonc-parser|require\(["']jsonc-parser/);
      expect(bundle).not.toContain("define.amd");
      expect(bundle).not.toContain("./impl/");
    } finally {
      NodeFS.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
