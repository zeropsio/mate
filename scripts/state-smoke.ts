#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- blocking CI smoke, shared with the local gate.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const pattern = Object.values(stateOnlySmoke)
    .flat()
    .map((title) => `(?:${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")})$`)
    .join("|");
  for (const [files, selection] of [
    [["test/scenarios/areas/a-signin"], undefined],
    [Object.keys(stateOnlySmoke).map((file) => NodePath.join(root, file)), pattern],
  ] as const) {
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
          MATE_GATE_SMOKE_CASES: JSON.stringify(stateOnlySmoke),
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
