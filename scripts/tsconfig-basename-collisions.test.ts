// @effect-diagnostics nodeBuiltinImport:off - This repository guard reads compiler-selected directories and invokes the installed TypeScript CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { describe, expect, it } from "@effect/vitest";
import { parse } from "yaml";

const repoRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const tsc = NodeURL.fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

function collisions(files: ReadonlyArray<string>): Array<Array<string>> {
  const byBasename = new Map<string, Array<string>>();
  for (const file of files) {
    if (!/\.(?:ts|tsx|mts|cts)$/u.test(file)) continue;
    const basename = file.replace(/\.(?:ts|tsx|mts|cts)$/u, "");
    const siblings = byBasename.get(basename) ?? [];
    siblings.push(file);
    byBasename.set(basename, siblings);
  }
  return [...byBasename.values()].filter((siblings) => siblings.length > 1);
}

async function configCollisions(config: string): Promise<Array<Array<string>>> {
  // Let the compiler resolve JSONC, extends, files, include, exclude and default includes.
  // Its file list suppresses same-basename siblings, so use it only to discover directories;
  // inspect each directory's raw entries to catch the files the compiler silently dropped.
  const { stdout } = await execFile(process.execPath, [tsc, "--showConfig", "-p", config], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const { files } = JSON.parse(stdout) as { files: Array<string> };
  const directories = new Set(
    files.map((file) => NodePath.dirname(NodePath.resolve(NodePath.dirname(config), file))),
  );
  const findings: Array<Array<string>> = [];
  for (const directory of [...directories].sort()) {
    const entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    findings.push(
      ...collisions(
        entries
          .filter((entry) => entry.isFile())
          .map((entry) => NodePath.join(directory, entry.name)),
      ),
    );
  }
  return findings;
}

describe("TypeScript basename collisions", () => {
  it.each(
    Array.from(["tsx", "mts", "cts"], (extension) => ({
      title: `reports .ts / .${extension} siblings`,
      extension,
    })),
  )("$title", ({ extension }) => {
    const files = ["src/view.test.ts", `src/view.test.${extension}`];
    expect(collisions(files)).toEqual([files]);
  });

  it("reports collisions between module extensions too", () => {
    expect(collisions(["src/view.mts", "src/view.cts"])).toEqual([
      ["src/view.mts", "src/view.cts"],
    ]);
  });

  it("keeps directories, render tests and declaration basenames distinct", () => {
    expect(
      collisions([
        "src/view.test.ts",
        "other/view.test.tsx",
        "src/view.render.test.tsx",
        "src/view.test.d.ts",
        "src/view.test.js",
      ]),
    ).toEqual([]);
  });

  it("checks raw siblings with inherited glob includes and skips excluded directories", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-tsconfig-"));
    try {
      await NodeFSP.mkdir(NodePath.join(directory, "src/nested"), { recursive: true });
      await NodeFSP.mkdir(NodePath.join(directory, "excluded"));
      for (const file of [
        "src/nested/view.ts",
        "src/nested/view.tsx",
        "excluded/view.ts",
        "excluded/view.tsx",
      ]) {
        await NodeFSP.writeFile(NodePath.join(directory, file), "export {};\n");
      }
      await NodeFSP.writeFile(
        NodePath.join(directory, "base.json"),
        JSON.stringify({ include: ["**/*.ts"], exclude: ["excluded"] }),
      );
      const config = NodePath.join(directory, "tsconfig.json");
      await NodeFSP.writeFile(config, '{ "extends": "./base.json" }');
      expect(await configCollisions(config)).toEqual([
        ["src/nested/view.ts", "src/nested/view.tsx"].map((file) => NodePath.join(directory, file)),
      ]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("has no colliding TypeScript basenames in any workspace package tsconfig", async () => {
    const workspace = parse(
      await NodeFSP.readFile(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
    ) as {
      packages: Array<string>;
    };
    const configs = [
      ...NodeFS.globSync(
        workspace.packages.map((pattern) => `${pattern}/tsconfig.json`),
        { cwd: repoRoot },
      ),
    ].sort();
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      const findings = await configCollisions(NodePath.join(repoRoot, config));
      expect(
        findings.map((siblings) => siblings.map((file) => NodePath.relative(repoRoot, file))),
        `${config}: rename siblings so TypeScript cannot silently omit them`,
      ).toEqual([]);
    }
  });
});
