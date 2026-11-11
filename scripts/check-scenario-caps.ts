// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalJsonInEffect:off -- gate check over the scenario tree.
/**
 * Every directory under the scenario areas has a case cap in `budget.json`, and holds no more
 * cases than it. Only the owner raises a cap. Cases under the owner-reported layout regressions
 * suite do not count; a table case counts once per row it declares.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { collectTestCases } from "./check-test-sentences.ts";
import { scenarioAreasRoot, scenarioCapsFile } from "./gate-input-scopes.ts";

const uncounted = "owner-reported layout regressions";

function scenarioFiles(directory: string): string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return scenarioFiles(path);
    return entry.isFile() && entry.name.endsWith(".scenario.ts") ? [path] : [];
  });
}

/** Cases each area holds, as its cap counts them. */
export function scenarioAreaCounts(root: string): Map<string, number> {
  const areas = NodePath.join(root, scenarioAreasRoot);
  const counts = new Map<string, number>();
  for (const entry of NodeFS.readdirSync(areas, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let count = 0;
    for (const file of scenarioFiles(NodePath.join(areas, entry.name)))
      for (const testCase of collectTestCases(NodeFS.readFileSync(file, "utf8"), file))
        if (!testCase.suite && !testCase.within.includes(uncounted))
          count += Math.max(1, testCase.titles.length - 1);
    counts.set(entry.name, count);
  }
  return counts;
}

/** What breaks the caps, one line each; empty when every area is within its cap. */
export function scenarioCapProblems(root: string): string[] {
  const caps: unknown = JSON.parse(
    NodeFS.readFileSync(NodePath.join(root, scenarioCapsFile), "utf8"),
  );
  if (typeof caps !== "object" || caps === null || Array.isArray(caps))
    return [`${scenarioCapsFile} must map each area to its case cap`];
  const capOf = new Map(Object.entries(caps));
  const counts = scenarioAreaCounts(root);
  const problems: string[] = [];
  for (const [area, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const cap = capOf.get(area);
    if (cap === undefined) problems.push(`${area}: no cap in ${scenarioCapsFile}`);
    else if (!Number.isSafeInteger(cap) || (cap as number) < 0)
      problems.push(`${area}: cap must be a whole number, got ${JSON.stringify(cap)}`);
    else if (count > (cap as number))
      problems.push(`${area}: ${count} cases, cap ${cap as number}; only the owner raises a cap`);
  }
  for (const area of capOf.keys())
    if (!counts.has(area)) problems.push(`${area}: capped in ${scenarioCapsFile}, no such area`);
  return problems;
}

if (import.meta.main) {
  const problems = scenarioCapProblems(process.cwd());
  for (const problem of problems) console.error(`scenario caps: ${problem}`);
  if (problems.length) process.exitCode = 1;
}
