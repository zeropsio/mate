import { readReleaseSource } from "@t3tools/shared/releaseSource";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { parse as parseYaml } from "yaml";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export type RollbackCompatibility =
  | { readonly rollbackCompatible: false }
  | { readonly rollbackCompatible: true; readonly compatibleFrom: string };

export interface RollbackEvidence {
  readonly previousTag: string;
  readonly candidateVersion: string;
  readonly ancestor: boolean;
  readonly previousProtocol: number | undefined;
  readonly currentProtocol: number | undefined;
  readonly previousPackage: string;
  readonly currentPackage: string;
  readonly changedPaths: ReadonlyArray<string>;
  /** Read only when the lockfile changed; its absence then fails closed. */
  readonly lockfiles?: { readonly previous: string; readonly current: string };
}

const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeProtocol = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ protocol: Schema.Literal(1) })),
);
const MANUAL: RollbackCompatibility = { rollbackCompatible: false };

const runtimeDeclaration = (encoded: string): string | undefined => {
  const decoded = decodePackage(encoded);
  return Option.isNone(decoded)
    ? undefined
    : JSON.stringify(
        Object.fromEntries(Object.entries(decoded.value).filter(([key]) => key !== "version")),
      );
};

/**
 * Paths proved not to touch stored state, the updater or the zcp seam. The rule is an
 * allowlist: a path that matches nothing here makes the release manual, so a directory or
 * package added later fails closed until someone verifies it and lists it with its reason.
 * Verification per entry: no `SqlClient`, secret store or state-dir write in the directory
 * (grep `writeFile|appendFile|makeDirectory|rename|SqlClient|SecretStore|stateDir`), and what it
 * writes lives in a user workspace or a temporary directory.
 */
const COMPATIBLE_PREFIXES: ReadonlyArray<readonly [prefix: string, reason: string]> = [
  ["apps/web/", "the hosted client; the Mate only serves its bundle"],
  ["apps/desktop/", "not part of the released server"],
  ["apps/mobile/", "not part of the released server"],
  ["docs/", "prose"],
  [".github/workflows/ci.yml", "verification only"],
  [".github/workflows/signal.yml", "verification only"],
  [".github/ISSUE_TEMPLATE/", "prose"],
  ["oxlint-plugin-t3code/", "lint rules"],
  [
    "scripts/",
    "repository tooling; the released artifact's pack and manifest are apps/server/scripts",
  ],
  ["packages/client-runtime/", "client-only; no server file imports it"],
  ["apps/server/src/git/", "repository operations; writes a temporary body file"],
  ["apps/server/src/sourceControl/", "clones into user-chosen workspace directories"],
  ["apps/server/src/textGeneration/", "one-shot generation; temporary isolated provider profiles"],
  ["apps/server/src/project/", "setup scripts; reads settings and projections"],
  ["apps/server/src/review/", "review service; reads"],
  ["apps/server/src/observability/", "tracing and heap snapshots; no stored format"],
  ["apps/server/src/diagnostics/", "reads"],
  ["apps/server/src/resourceTelemetry/", "in-memory samples"],
  ["apps/server/src/background/", "reads settings; no stored format"],
  ["apps/server/src/stream/", "stream helpers"],
  ["apps/server/src/utils/", "pure helpers"],
  ["apps/server/src/workspace/", "reads and writes the user's workspace files only"],
  ["apps/server/src/testUtils/", "test tooling"],
  ["apps/server/src/testing/", "test tooling"],
  // `packages/shared` hq* modules are HQ wire schemas, versioned by HQ. The persistence guard
  // test keeps them free of persistence imports and reachable only from `zerops/`.
  ["packages/shared/src/hq", "HQ wire schemas, not stored by the Mate"],
];

/**
 * Single files whose change cannot alter what the previous release reads back. The server
 * manifest's runtime declaration and the update protocol are compared separately; dependencies
 * are judged by the lockfile closure below.
 */
const COMPATIBLE_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "apps/server/package.json",
  "apps/server/update-protocol.json",
  "README.md",
  ".github/pull_request_template.md",
  "zerops.yml",
]);

/** A `link:` target resolved against its importer directory, as the lockfile's importer id. */
const resolveLink = (from: string, target: string): string =>
  [...from.split("/"), ...target.split("/")]
    .reduce<Array<string>>((resolved, segment) => {
      if (segment === "..") resolved.pop();
      else if (segment !== "." && segment !== "") resolved.push(segment);
      return resolved;
    }, [])
    .join("/");

const isTest = (path: string): boolean => /\.test\.tsx?$/u.test(path);

/** The first path outside the allowlist, or undefined. The lockfile is judged separately. */
const unlistedPath = (paths: ReadonlyArray<string>): string | undefined =>
  paths.find(
    (path) =>
      path !== "pnpm-lock.yaml" &&
      !isTest(path) &&
      !COMPATIBLE_FILES.has(path) &&
      !COMPATIBLE_PREFIXES.some(([prefix]) => path.startsWith(prefix)),
  );

interface LockImporter {
  readonly dependencies?: Record<string, { readonly version?: string } | undefined>;
  readonly devDependencies?: Record<string, { readonly version?: string } | undefined>;
}
type LockSnapshots = Record<
  string,
  | {
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  | undefined
>;

/**
 * The lockfile restricted to what the server bundle resolves: the `apps/server` production
 * dependencies, those of every workspace package it links (the bundle inlines them with their
 * own dependencies), and all transitive snapshots. Tooling-only changes leave it identical; an
 * unreadable lockfile has none.
 */
const serverRuntimeClosure = (lock: string): string | undefined => {
  try {
    const parsed = parseYaml(lock) as {
      importers?: Record<string, LockImporter | undefined>;
      snapshots?: LockSnapshots;
    };
    const { importers, snapshots } = parsed;
    if (importers?.["apps/server"] === undefined || snapshots === undefined) return undefined;
    const visited = new Map<string, unknown>();
    const seenImporters = new Set<string>();
    const queue: Array<string> = [];
    const pushImporter = (id: string) => {
      if (seenImporters.has(id)) return;
      seenImporters.add(id);
      const importer = importers[id];
      if (importer === undefined) throw new Error(`unknown importer ${id}`);
      visit(id, importer.dependencies, false);
      visit(id, importer.devDependencies, true);
    };
    const visit = (from: string, section: LockImporter["dependencies"], linkedOnly: boolean) => {
      for (const [name, entry] of Object.entries(section ?? {})) {
        const version = entry?.version ?? "";
        if (version.startsWith("link:")) {
          pushImporter(resolveLink(from, version.slice("link:".length)));
        } else if (!linkedOnly) {
          queue.push(`${name}@${version}`);
        }
      }
    };
    pushImporter("apps/server");
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      if (visited.has(key)) continue;
      const snapshot = snapshots[key];
      visited.set(key, snapshot ?? null);
      for (const [name, version] of Object.entries({
        ...snapshot?.dependencies,
        ...snapshot?.optionalDependencies,
      }))
        queue.push(`${name}@${version}`);
    }
    return JSON.stringify([...visited].sort(([a], [b]) => a.localeCompare(b)));
  } catch {
    return undefined;
  }
};

/**
 * Why the release needs an attended update, or undefined when it may update automatically.
 * A release is rollback-compatible from the previous stable only when every changed path is on
 * the allowlist, the server's runtime dependency closure did not move, and the runtime
 * declaration and update protocol are unchanged. Anything unproven is a blocker.
 */
export function rollbackBlocker(evidence: RollbackEvidence): string | undefined {
  const from = evidence.previousTag.startsWith("v") ? evidence.previousTag.slice(1) : "";
  if (!stableVersion.test(from))
    return `previous tag ${evidence.previousTag} is not a stable release`;
  if (!stableVersion.test(evidence.candidateVersion))
    return `candidate ${evidence.candidateVersion} is not a stable version`;
  if (compareSemverVersions(from, evidence.candidateVersion) >= 0)
    return `candidate ${evidence.candidateVersion} does not follow ${evidence.previousTag}`;
  if (!evidence.ancestor) return `${evidence.previousTag} is not an ancestor of the candidate`;
  if (evidence.previousProtocol !== 1 || evidence.currentProtocol !== 1)
    return "the update protocol changed or is unreadable";
  const previousRuntime = runtimeDeclaration(evidence.previousPackage);
  if (
    previousRuntime === undefined ||
    previousRuntime !== runtimeDeclaration(evidence.currentPackage)
  )
    return "the server's runtime declaration changed or is unreadable";
  const unlisted = unlistedPath(evidence.changedPaths);
  if (unlisted !== undefined) return `${unlisted} is not proved free of stored or seam state`;
  if (!evidence.changedPaths.includes("pnpm-lock.yaml")) return undefined;
  const previous = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.previous);
  const current = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.current);
  return previous !== undefined && previous === current
    ? undefined
    : "pnpm-lock.yaml moved the server's runtime dependencies or cannot be compared";
}

export function rollbackCompatibility(evidence: RollbackEvidence): RollbackCompatibility {
  return rollbackBlocker(evidence) === undefined
    ? { rollbackCompatible: true, compatibleFrom: evidence.previousTag.slice(1) }
    : MANUAL;
}

/** A failed or incomplete git probe never stamps permission into a release. */
export const readRollbackCompatibility = Effect.fn("readRollbackCompatibility")(
  function* (previousTag: string, candidateVersion: string, cwd?: string) {
    const manual = (reason: string) =>
      Effect.logInfo(`[release] manual update: ${reason}`).pipe(Effect.as(MANUAL));
    if (!previousTag.startsWith("v") || !stableVersion.test(previousTag.slice(1)))
      return yield* manual(`previous tag ${previousTag} is not a stable release`);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(ChildProcess.make("git", args, { stderr: "ignore", cwd }));
      const [output, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { output, code };
    }, Effect.scoped);
    const previousSource = yield* readReleaseSource(previousTag, git);
    const currentSource = yield* readReleaseSource("HEAD", git);
    if (previousSource === undefined || currentSource === undefined)
      return yield* manual(`the release source of ${previousTag} or HEAD cannot be read`);
    const ancestor = yield* git(["merge-base", "--is-ancestor", previousSource, currentSource]);
    if (ancestor.code !== 0)
      return yield* manual(`${previousTag} is not an ancestor of the candidate`);
    const reads = {
      previousProtocol: yield* git(["show", `${previousTag}:apps/server/update-protocol.json`]),
      currentProtocol: yield* git(["show", "HEAD:apps/server/update-protocol.json"]),
      previousPackage: yield* git(["show", `${previousTag}:apps/server/package.json`]),
      currentPackage: yield* git(["show", "HEAD:apps/server/package.json"]),
      changed: yield* git(["diff", "--no-renames", "--name-only", "-z", previousTag, "HEAD"]),
    };
    const failed = Object.entries(reads).find(([, read]) => read.code !== 0);
    if (failed !== undefined) return yield* manual(`git could not read ${failed[0]}`);
    const changedPaths = reads.changed.output.split("\0").filter(Boolean);
    const lockChanged = changedPaths.includes("pnpm-lock.yaml");
    const previousLock = lockChanged
      ? yield* git(["show", `${previousTag}:pnpm-lock.yaml`])
      : undefined;
    const currentLock = lockChanged ? yield* git(["show", "HEAD:pnpm-lock.yaml"]) : undefined;
    const evidence: RollbackEvidence = {
      previousTag,
      candidateVersion,
      ancestor: true,
      previousProtocol: Option.getOrUndefined(decodeProtocol(reads.previousProtocol.output))
        ?.protocol,
      currentProtocol: Option.getOrUndefined(decodeProtocol(reads.currentProtocol.output))
        ?.protocol,
      previousPackage: reads.previousPackage.output,
      currentPackage: reads.currentPackage.output,
      changedPaths,
      ...(previousLock?.code === 0 && currentLock?.code === 0
        ? { lockfiles: { previous: previousLock.output, current: currentLock.output } }
        : {}),
    };
    const blocker = rollbackBlocker(evidence);
    return blocker === undefined
      ? rollbackCompatibility(evidence)
      : yield* manual(`${previousTag} → ${candidateVersion}: ${blocker}`);
  },
  Effect.orElseSucceed(() => MANUAL),
);
