#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - a thin runner over CI's own job definition.
/**
 * CI's Check job, run locally: the same steps in the same order, read from
 * `.github/workflows/ci.yml` at run time, so the local run cannot drift from CI. One line per step,
 * the tail of each failure, exit 1 when any step failed.
 *
 *   node scripts/ci-local.ts              every step of the Check job
 *   node scripts/ci-local.ts css guard    only the steps whose name holds one of the words
 *   node scripts/ci-local.ts --full       Check plus every unit/scenario suite (prefer branch CI)
 *   node scripts/ci-local.ts --list       the steps, without running them
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { parse } from "yaml";

export interface CheckStep {
  readonly name: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
  readonly workingDirectory: string | undefined;
}

interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly "working-directory"?: string;
}

interface Workflow {
  readonly jobs?: Record<
    string,
    { readonly env?: Record<string, string>; readonly steps?: WorkflowStep[] }
  >;
}

const usesContext = (text: string) => text.includes("${{");

/**
 * The job's `run` steps in order. A `uses` step sets up a runner that a checkout already is; a
 * step behind an `if`, or one that reads a `${{ }}` context, only means something on CI.
 */
export function checkSteps(workflowYaml: string, jobId = "check"): ReadonlyArray<CheckStep> {
  const job = (parse(workflowYaml) as Workflow).jobs?.[jobId];
  if (!job?.steps) throw new Error(`no job "${jobId}" with steps in the workflow`);
  return job.steps.flatMap((step) => {
    if (step.run === undefined || step.if !== undefined || usesContext(step.run)) return [];
    const env = Object.fromEntries(
      Object.entries({ ...job.env, ...step.env }).filter(
        ([, value]) => !usesContext(String(value)),
      ),
    );
    return [
      {
        name: step.name ?? step.run.split("\n")[0]!,
        run: step.run,
        env,
        workingDirectory: step["working-directory"],
      },
    ];
  });
}

/** All CI unit/scenario jobs, unsharded on a local machine. Prefer branch CI for this load. */
export function suiteSteps(workflowYaml: string): ReadonlyArray<CheckStep> {
  const workflow = parse(workflowYaml) as Workflow;
  return Object.entries(workflow.jobs ?? {})
    .filter(([id]) => id === "test" || id.startsWith("test_"))
    .flatMap(([id, job]) =>
      (job.steps ?? []).flatMap((step) => {
        if (!step.run || !step.name?.startsWith("Test")) return [];
        const run = step.run.replace(
          / --shard \$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}/gu,
          "",
        );
        if (usesContext(run)) throw new Error(`Cannot run ${id} locally: unresolved CI context`);
        return [
          {
            name: `${id}: ${step.name}`,
            run,
            env: {},
            workingDirectory: step["working-directory"],
          },
        ];
      }),
    );
}

/** The steps whose name holds one of the words, in any case; no words keeps every step. */
export function selectSteps(
  steps: ReadonlyArray<CheckStep>,
  words: ReadonlyArray<string>,
): ReadonlyArray<CheckStep> {
  const wanted = words.map((word) => word.toLowerCase());
  if (wanted.length === 0) return steps;
  return steps.filter((step) => wanted.some((word) => step.name.toLowerCase().includes(word)));
}

const tail = (text: string, lines: number) => text.trimEnd().split("\n").slice(-lines).join("\n");

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const workflow = NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8");
  const steps = selectSteps(
    [...checkSteps(workflow), ...(args.includes("--full") ? suiteSteps(workflow) : [])],
    args.filter((arg) => !arg.startsWith("--")),
  );
  if (args.includes("--list")) {
    steps.forEach((step, index) => console.log(`${String(index + 1).padStart(2)}  ${step.name}`));
    process.exit(0);
  }
  // CI's runner has the workspace's binaries on PATH, and `check-guard-exceptions` spawns `vp` from it.
  const PATH = [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
    NodePath.delimiter,
  );
  let failed = 0;
  for (const step of steps) {
    const started = Date.now();
    const result = NodeChildProcess.spawnSync("bash", ["-eo", "pipefail", "-c", step.run], {
      cwd: NodePath.join(root, step.workingDirectory ?? "."),
      env: { ...process.env, ...step.env, CI: "true", PATH },
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.status === 0) {
      console.log(`ok    ${step.name} (${seconds}s)`);
    } else {
      failed += 1;
      console.log(
        `FAIL  ${step.name} (${seconds}s)\n${tail(`${result.stdout}${result.stderr}`, 40)}\n`,
      );
    }
  }
  console.log(
    failed === 0 ? `all ${steps.length} steps passed` : `${failed} of ${steps.length} steps failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
