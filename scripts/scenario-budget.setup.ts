// @effect-diagnostics nodeBuiltinImport:off -- one streak receipt per serial scenario run, shared across isolated workers.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  interface ProvidedContext {
    scenarioTimeoutStreak: string;
  }
}

export default function setup(project: TestProject) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-scenario-budget-"));
  const receipt = NodePath.join(directory, "streak.json");
  NodeFS.writeFileSync(receipt, "[]");
  project.provide("scenarioTimeoutStreak", receipt);
  return () => NodeFS.rmSync(directory, { recursive: true, force: true });
}
