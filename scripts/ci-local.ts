#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - a thin runner over CI's own job definition.
/**
 * Manual diagnostic for CI's parallel Check jobs, run locally with desktop/mobile work deferred during the test phase, read from
 * `.github/workflows/ci.yml` at run time. Browser shards belong to Signal, not Check. One line per step,
 * the first error and a short tail on failure, then stop with its exit code.
 *
 *   node scripts/ci-local.ts              every step of the Check jobs
 *   node scripts/ci-local.ts css guard    only the steps whose name holds one of the words
 *   node scripts/ci-local.ts --list       the steps, without running them
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { parse } from "yaml";
import { checkJobIds } from "./ci-blame.ts";
import { failureSummary, gateLogDirectory, runLogged } from "./gate-log.ts";

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
 * The Check jobs' `run` steps in order, sharing one install locally. An explicit job ID selects
 * that job alone. A `uses` step sets up a runner that a checkout already is; a
 * promotion skip is never available locally. Other conditional steps and `${{ }}` contexts
 * only mean something on CI.
 */
export function checkSteps(workflowYaml: string, jobId?: string): ReadonlyArray<CheckStep> {
  const jobs = (parse(workflowYaml) as Workflow).jobs;
  const selected = jobId === undefined ? checkJobIds.filter((id) => jobs?.[id]?.steps) : [jobId];
  if (selected.length === 0) throw new Error('no job "check" with steps in the workflow');
  const installs = new Set<string>();
  return selected.flatMap((id) => {
    const job = jobs?.[id];
    if (!job?.steps) throw new Error(`no job "${id}" with steps in the workflow`);
    return job.steps.flatMap((step) => {
      if (
        step.run === undefined ||
        (step.if !== undefined && step.if !== "needs.prepare.outputs.skip != 'true'") ||
        usesContext(step.run) ||
        /\$\{?GITHUB_OUTPUT\b/u.test(step.run)
      )
        return [];
      // The hosted web test phase needs neither native-client generation nor Electron setup.
      if (
        /@t3tools\/(?:mobile|desktop)\b/u.test(step.run) ||
        /^apps\/(?:mobile|desktop)(?:\/|$)/u.test(step["working-directory"] ?? "")
      )
        return [];
      if (jobId === undefined && step.name === "Install dependencies") {
        if (installs.has(step.run)) return [];
        installs.add(step.run);
      }
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
  });
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

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const workflow = NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8");
  const steps = selectSteps(
    checkSteps(workflow),
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
  const logs = gateLogDirectory("ci-local");
  console.log(`Full logs: ${logs}`);
  for (const [index, step] of steps.entries()) {
    const logPath = NodePath.join(logs, `${index + 1}.log`);
    const started = Date.now();
    const status = runLogged(
      "bash",
      ["-eo", "pipefail", "-c", step.run],
      {
        cwd: NodePath.join(root, step.workingDirectory ?? "."),
        env: {
          ...process.env,
          ...step.env,
          CI: "true",
          MATE_TEST_JOBS: process.env.MATE_TEST_JOBS ?? "8",
          PATH,
        },
      },
      logPath,
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (status === 0) {
      console.log(`ok    ${step.name} (${seconds}s)`);
    } else {
      console.error(
        `FAIL  ${step.name} (${seconds}s)\n${failureSummary(NodeFS.readFileSync(logPath, "utf8"), logPath)}`,
      );
      process.exit(status);
    }
  }
  console.log(`all ${steps.length} steps passed`);
}
