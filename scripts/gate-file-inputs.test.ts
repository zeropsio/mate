// @effect-diagnostics nodeBuiltinImport:off -- verifies the test selection declarations.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { expect, it } from "vite-plus/test";
import { fileReadInputs, hasFileReads } from "./gate-file-inputs.ts";

it.each([
  ["import * as fs from 'node:fs'; fs.readFileSync(path);", true],
  ["import { readFile as bytes } from 'node:fs/promises'; bytes(path);", true],
  ["const fs = yield* FileSystem.FileSystem; yield* fs.readFileString(path);", true],
  ["fs['readDirectory'](path);", true],
  ["// fs.readFileSync(path)\nconst script = 'fs.readFileSync(path)';", false],
])("filesystem reads are checked as calls (%s)", (source, expected) => {
  expect(hasFileReads(parseSync("fixture.ts", source).program)).toBe(expected);
});

it("every filesystem-reading test declares checkout inputs or disposable-only reads", () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const missing: string[] = [];
  const visit = (directory: string): void => {
    if (!NodeFS.existsSync(NodePath.join(root, directory))) return;
    for (const entry of NodeFS.readdirSync(NodePath.join(root, directory), {
      withFileTypes: true,
    })) {
      if (["node_modules", "dist", "dist-electron", ".plans", ".git"].includes(entry.name))
        continue;
      const file = NodePath.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) {
        const parsed = parseSync(file, NodeFS.readFileSync(NodePath.join(root, file), "utf8"));
        if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0]!.message}`);
        if (hasFileReads(parsed.program) && !Object.hasOwn(fileReadInputs, file))
          missing.push(file);
      }
    }
  };
  for (const directory of ["scripts", "oxlint-plugin-t3code", "packages", "apps", "infra"])
    visit(directory);
  expect(
    missing,
    "ASSERTION: filesystem-reading tests cannot disappear from gate selection",
  ).toEqual([]);
});
