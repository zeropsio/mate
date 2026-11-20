// @effect-diagnostics nodeBuiltinImport:off -- host Git scope for the gate and its guards.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

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

/** The files the runtime cycle ratchet leaves out of its graph; the gate's input set for it too. */
export const runtimeCycleExcludes = [
  /\.test\./,
  /\.spec\./,
  /\/__fixtures__\//,
  /\/testing\//,
  /routeTree\.gen/,
];

/**
 * The ratchet's resolution of workspace imports, from each package's `exports` into its `src`: the
 * ratchet follows these into packages beyond its source roots, so the gate reads them as its inputs.
 */
export function sourceAliases(root: string): Record<string, string[]> {
  const paths: Record<string, string[]> = { "~/*": ["apps/web/src/*"] };
  for (const group of ["packages", "apps"]) {
    if (!NodeFS.existsSync(NodePath.join(root, group))) continue;
    for (const entry of NodeFS.readdirSync(NodePath.join(root, group))) {
      const directory = NodePath.join(group, entry);
      const manifest = NodePath.join(root, directory, "package.json");
      if (!NodeFS.existsSync(manifest)) continue;
      const pkg = JSON.parse(NodeFS.readFileSync(manifest, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      if (!pkg.name || !pkg.exports) continue;
      for (const [subpath, target] of Object.entries(pkg.exports)) {
        const source =
          typeof target === "string"
            ? target
            : target !== null && typeof target === "object" && "types" in target
              ? target.types
              : undefined;
        if (typeof source !== "string" || !source.startsWith("./src/")) continue;
        paths[subpath === "." ? pkg.name : pkg.name + subpath.slice(1)] = [
          NodePath.join(directory, source),
        ];
      }
    }
  }
  return paths;
}

export const retainedTestFile = /\.test\.tsx?$/u;

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
    ["grep", "--untracked", "--null", "-I", "-F", "-e", witnessMarker],
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
