#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- blocking CI smoke and affected scenarios.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { affectedScenarioFiles } from "./gate-changed.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

export function runStateSmoke(root: string, args: ReadonlyArray<string>): number {
  let base: string | undefined;
  let shard = "1/1";
  const namedScenarios: string[] = [];
  for (let cursor = 0; cursor < args.length; cursor++) {
    const argument = args[cursor];
    if (argument === "--base" || argument === "--shard") {
      const value = args[++cursor];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--base") base = value;
      else shard = value;
    } else if (argument === "--scenarios") {
      const start = cursor;
      while (args[cursor + 1] && !args[cursor + 1]!.startsWith("--")) {
        namedScenarios.push(args[++cursor]!);
      }
      if (cursor === start) throw new Error("--scenarios requires at least one scenario file");
    } else throw new Error(`Unknown State Smoke argument: ${argument}`);
  }
  const [index, count] = shard.split("/").map(Number) as [number, number];
  if (
    !/^\d+\/\d+$/u.test(shard) ||
    !(Number.isInteger(index) && Number.isInteger(count) && index >= 1 && index <= count)
  )
    throw new Error(`--shard expects <index>/<count>, got ${shard}`);

  // A new branch has no previous commit. Compare its entire tree instead of silently dropping changes.
  if (!base || /^0+$/u.test(base)) {
    const emptyTree = NodeChildProcess.spawnSync("git", ["hash-object", "-t", "tree", "--stdin"], {
      cwd: root,
      input: "",
      encoding: "utf8",
    });
    if (emptyTree.error) throw emptyTree.error;
    if (emptyTree.status !== 0 || !emptyTree.stdout.trim())
      throw new Error(`State Smoke cannot resolve its comparison base: ${emptyTree.stderr}`);
    base = emptyTree.stdout.trim();
  }
  const affected = affectedScenarioFiles(root, base, namedScenarios);
  const smoke = Object.fromEntries(
    Object.entries(stateOnlySmoke).filter(([file]) => !affected.includes(file)),
  );
  const pattern = Object.values(smoke)
    .flat()
    .map((title) => `(?:${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")})$`)
    .join("|");
  // Keep sign-in and fixed smoke on their existing shards; spread full affected files across both.
  const stages: { files: string[]; selection?: string }[] = [];
  if (index === 1) stages.push({ files: ["test/scenarios/areas/a-signin"] });
  if (1 % count === index - 1 && Object.keys(smoke).length)
    stages.push({
      files: Object.keys(smoke).map((file) => NodePath.join(root, file)),
      selection: pattern,
    });
  const selected = affected
    .filter((file) => !file.startsWith("apps/web/test/scenarios/areas/a-signin/"))
    .filter((_, position) => position % count === index - 1);
  if (selected.length) stages.push({ files: selected.map((file) => NodePath.join(root, file)) });

  for (const { files, selection } of stages) {
    const result = NodeChildProcess.spawnSync(
      "vp",
      [
        "test",
        "run",
        "--config",
        "test/scenarios/vitest.config.ts",
        "--project",
        "scenarios",
        ...files,
        ...(selection ? ["--testNamePattern", selection] : []),
        "--allowOnly=false",
        "--reporter=default",
        `--reporter=../../scripts/${selection ? "gate-smoke" : "chat-gate"}-reporter.ts`,
      ],
      {
        cwd: NodePath.join(root, "apps/web"),
        stdio: "inherit",
        env: {
          ...process.env,
          VITEST_MAX_WORKERS: undefined,
          MATE_GATE_SMOKE_CASES: JSON.stringify(smoke),
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = runStateSmoke(
    NodePath.resolve(import.meta.dirname, ".."),
    process.argv.slice(2),
  );
}
