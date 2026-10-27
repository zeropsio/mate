#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalConsole:off globalDate:off -- blocking CI smoke and affected scenarios.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { stateSmokeMatrix } from "./ci-blame.ts";
import { affectedScenarioFiles } from "./gate-changed.ts";
import { scenarioDurations } from "./lib/scenario-durations.ts";
import { spreadShard } from "./lib/spread-shard.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

const signIn = "apps/web/test/scenarios/areas/a-signin/";
const fixedSmoke = "fixed smoke";
// The fixed smoke's own cases in State Smoke 2 of run 40543451029 (2026-10-27).
const fixedSmokeDurations: Record<keyof typeof stateOnlySmoke, number> = {
  "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts": 67_209,
  "apps/web/test/scenarios/areas/c-mate/engine-secret.scenario.ts": 6_945,
  "apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts": 8_530,
};
// Setup takes about three of a shard's 14 minutes; its scenarios get the rest less a margin.
const shardBudgetMs = 9 * 60_000;
const maxShards = 16;
// Small selections keep the spread they always had, without empty shards.
const usualShards = 8;

/**
 * Sign-in, the blocking door, runs alone on the first of several shards; the fixed smoke and the
 * affected files spread over the others by measured time. Files without a measurement cost the
 * measured mean, so an unmeasured selection splits by count. Without `count`, the plan takes as
 * many shards as keep each under the budget.
 */
export function stateSmokePlan(
  affected: ReadonlyArray<string>,
  count?: number,
  durations: Readonly<Record<string, number>> = scenarioDurations,
) {
  const smoke = Object.fromEntries(
    Object.entries(stateOnlySmoke).filter(([file]) => !affected.includes(file)),
  );
  const measured = Object.values(durations);
  // Any equal cost splits by count when nothing is measured.
  const unmeasured = measured.length
    ? measured.reduce((sum, ms) => sum + ms, 0) / measured.length
    : 1;
  const cost: Record<string, number> = {};
  for (const file of affected.filter((file) => !file.startsWith(signIn)))
    cost[file] = durations[file] ?? unmeasured;
  if (Object.keys(smoke).length)
    cost[fixedSmoke] = Object.keys(smoke).reduce(
      (sum, file) => sum + fixedSmokeDurations[file as keyof typeof stateOnlySmoke],
      0,
    );
  const signInMs = Object.entries(durations)
    .filter(([file]) => file.startsWith(signIn))
    .reduce((sum, [, ms]) => sum + ms, 0);
  const items = Object.keys(cost);
  const split = (total: number) =>
    (total === 1
      ? [[signIn, ...items]]
      : [
          [signIn],
          ...Array.from({ length: total - 1 }, (_, index) =>
            spreadShard(items, index + 1, total - 1, cost),
          ),
        ]
    ).map((members) => ({
      signIn: members.includes(signIn),
      smoke: members.includes(fixedSmoke),
      files: affected.filter((file) => members.includes(file)),
      estimateMs:
        (members.includes(signIn) ? signInMs : 0) +
        members.reduce((sum, member) => sum + (cost[member] ?? 0), 0),
    }));
  let total = count ?? 1;
  if (count === undefined && items.length) {
    const target = Math.max(shardBudgetMs, ...Object.values(cost));
    let spread = 1;
    while (
      spread < maxShards - 1 &&
      Math.max(...split(spread + 1).map(({ estimateMs }) => estimateMs)) > target
    )
      spread++;
    total = 1 + Math.max(spread, Math.min(usualShards - 1, items.length));
  }
  return { smoke, shards: split(total) };
}

export function runStateSmoke(root: string, args: ReadonlyArray<string>): number {
  let base: string | undefined;
  let planned: string[] | undefined;
  let shard = "1/1";
  let plan = false;
  let requested: "all" | number[] = "all";
  const namedScenarios: string[] = [];
  for (let cursor = 0; cursor < args.length; cursor++) {
    const argument = args[cursor];
    if (argument === "--plan") plan = true;
    else if (
      argument === "--base" ||
      argument === "--shard" ||
      argument === "--selection" ||
      argument === "--shards"
    ) {
      const value = args[++cursor];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--base") base = value;
      else if (argument === "--selection") planned = JSON.parse(value) as string[];
      else if (argument === "--shards") requested = JSON.parse(value) as "all" | number[];
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

  if (planned && (base || plan || namedScenarios.length))
    throw new Error("--selection is the plan's result; it takes no --base, --plan or --scenarios");

  // A new branch has no previous commit. Compare its entire tree instead of silently dropping changes.
  if (!planned && (!base || /^0+$/u.test(base))) {
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
  const started = Date.now();
  const affected = planned ?? affectedScenarioFiles(root, base!, namedScenarios);
  if (plan) {
    const { shards } = stateSmokePlan(affected);
    console.log(
      `State Smoke plan: ${shards.length} shards for ${affected.length} affected scenario files ` +
        `(selected in ${((Date.now() - started) / 1000).toFixed(1)} s)`,
    );
    shards.forEach((part, index) => {
      const work = [
        ...(part.signIn ? ["sign-in"] : []),
        ...(part.smoke ? ["fixed smoke"] : []),
        ...(part.files.length ? [`${part.files.length} files`] : []),
      ];
      console.log(
        `  State Smoke ${index + 1}: ${work.join(" + ")}, ~${(part.estimateMs / 60_000).toFixed(1)} min`,
      );
    });
    if (process.env.GITHUB_OUTPUT)
      NodeFS.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `state_smoke=${JSON.stringify(stateSmokeMatrix(shards.length, requested))}\n` +
          `state_smoke_selection=${JSON.stringify(affected)}\n`,
      );
    return 0;
  }
  const { smoke, shards } = stateSmokePlan(affected, count);
  const part = shards[index - 1]!;
  const pattern = Object.values(smoke)
    .flat()
    .map((title) => `(?:${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")})$`)
    .join("|");
  const stages: { files: string[]; selection?: string }[] = [];
  if (part.signIn) stages.push({ files: ["test/scenarios/areas/a-signin"] });
  if (part.smoke)
    stages.push({
      files: Object.keys(smoke).map((file) => NodePath.join(root, file)),
      selection: pattern,
    });
  if (part.files.length)
    stages.push({ files: part.files.map((file) => NodePath.join(root, file)) });

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
