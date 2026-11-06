// @effect-diagnostics nodeBuiltinImport:off -- host Git scope for the gate and its guards.
import * as NodeChildProcess from "node:child_process";

/**
 * The reviewed source roots scanned by every oxlint-side guard: the client sources (each rule still
 * decides from a file's path whether it applies).
 */
export const guardScopePaths = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/shared/src",
  "packages/client-runtime/src",
] as const;

export const runtimeCycleSourceRoots = [
  "apps/web/src",
  "apps/server/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/client-runtime/src",
  "packages/contracts/src",
  "packages/shared/src",
];

export const retainedTestFile = /(?:\.test\.tsx?|\.scenario\.ts)$/u;

// Test and scenario code whose time must come from the harness or scenario clock.
export const testClockFile = (path: string): boolean =>
  !path.startsWith(".repos/") &&
  /(?:\.test\.ts|\.scenario\.ts)$|(?:^|\/)test\/scenarios\/.+\.ts$/u.test(path);
export const testClockLedger = "scripts/test-clock-exceptions.json";

/** A case's witness line, `// witness: <owner path> | <old> → <new>`; an empty new text deletes. */
export interface Witness {
  readonly owner: string;
  readonly old: string;
  readonly next: string;
}

/** The path ends at the first ` | `; old and new split at the last ` →`, so code may hold arrows. */
export function parseWitness(text: string): Witness | undefined {
  const bar = text.indexOf(" | ");
  if (bar <= 0) return undefined;
  const rest = text.slice(bar + 3);
  const arrow = rest.lastIndexOf(" →");
  if (arrow < 0 || (rest.length > arrow + 2 && rest[arrow + 2] !== " ")) return undefined;
  return { owner: text.slice(0, bar), old: rest.slice(0, arrow), next: rest.slice(arrow + 3) };
}

const witnessMarker = "// witness: ";

/**
 * Retained test files in the working tree (tracked and untracked) mapped to the owner paths their
 * witness lines name; the sentence guard and its gate receipt read the same scope.
 */
export function witnessOwners(root: string): Map<string, Set<string>> {
  const result = NodeChildProcess.spawnSync(
    "git",
    ["grep", "--untracked", "--null", "-I", "-F", "-e", witnessMarker, "--", ":!.repos"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0 && result.status !== 1)
    throw new Error(result.stderr || result.error?.message || "git grep failed");
  const owners = new Map<string, Set<string>>();
  for (const line of result.stdout.split("\n")) {
    const split = line.indexOf("\0");
    const path = line.slice(0, split);
    if (split < 0 || !retainedTestFile.test(path)) continue;
    const text = line.slice(line.indexOf(witnessMarker, split) + witnessMarker.length).trimEnd();
    const owner = parseWitness(text)?.owner;
    if (owner !== undefined) owners.set(path, (owners.get(path) ?? new Set()).add(owner));
  }
  return owners;
}
