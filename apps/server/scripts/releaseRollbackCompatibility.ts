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

const SERVER_SRC = "apps/server/src/";

/**
 * What the previous release must still read back, as path globs. Anything not named here is
 * server behaviour that leaves the stored state, the updater and the zcp seam untouched.
 * A directory whose persistence is unproven stays listed: unsure means manual.
 */
const PERSISTED_PREFIXES: ReadonlyArray<string> = [
  // SQLite schema, migrations, projections (V1 `orchestration/` projects into them).
  `${SERVER_SRC}persistence/`,
  `${SERVER_SRC}orchestration/`,
  // The event-sourced engine: its store and migrations, what `decide`/`evolve` mean by an
  // event, the effect outbox, wakes, imported history.
  `${SERVER_SRC}engine/`,
  // Provider resume cursors, session runtime and credential files.
  `${SERVER_SRC}provider/`,
  // Files under the state dir: secrets, sessions, assets, terminal history, usage outbox.
  `${SERVER_SRC}auth/`,
  `${SERVER_SRC}assets/`,
  `${SERVER_SRC}terminal/`,
  `${SERVER_SRC}usage/`,
  // Updater: drain, admission, native resume.
  `${SERVER_SRC}update/`,
  // The zcp seam (spec-mate §2.8): flags C-2, descriptor C-4, Git credential C-7, boot, HQ link.
  `${SERVER_SRC}cli/`,
  `${SERVER_SRC}cloud/`,
  `${SERVER_SRC}environment/`,
  `${SERVER_SRC}zerops/`,
  // The released artifact itself (C-1): pack and manifest.
  "apps/server/scripts/",
  // Contracts compose the stored engine, orchestration and settings schemas across many files.
  "packages/contracts/",
];

const PERSISTED_FILES: ReadonlySet<string> = new Set(
  [
    "atomicWrite.ts",
    "attachmentPaths.ts",
    "attachmentStore.ts",
    "bin.ts",
    "config.ts",
    "entrypoint.ts",
    "http.ts",
    "httpCors.ts",
    "keybindings.ts",
    "mateUpdateBoot.ts",
    "RpcUpdateAdmission.ts",
    "serverRuntimeState.ts",
    "serverSettings.ts",
    "uploadsFolder.ts",
  ].map((name) => `${SERVER_SRC}${name}`),
);

/**
 * The HQ wire formats in `packages/shared` are versioned by HQ, not stored by the Mate; every
 * other shared file may define a stored format and stays listed.
 */
const isHqWireModule = (path: string): boolean =>
  /^packages\/shared\/src\/hq[A-Za-z]*(\.ts|\/)/u.test(path);

const isTest = (path: string): boolean => /\.test\.tsx?$/u.test(path);

const touchesPersistedSurface = (path: string): boolean => {
  if (isTest(path) || path === "pnpm-lock.yaml") return false;
  if (PERSISTED_FILES.has(path)) return true;
  if (PERSISTED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return path.startsWith("packages/shared/") && !isHqWireModule(path);
};

type LockSection = Record<string, { readonly version?: string } | undefined>;
type LockSnapshots = Record<
  string,
  | {
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  | undefined
>;

/**
 * The lockfile restricted to what the server bundle and release manifest resolve: the
 * `apps/server` production dependencies and their transitive snapshots. Dev-only changes leave
 * it identical; an unreadable lockfile has none.
 */
const serverRuntimeClosure = (lock: string): string | undefined => {
  try {
    const parsed = parseYaml(lock) as {
      importers?: Record<string, { dependencies?: LockSection } | undefined>;
      snapshots?: LockSnapshots;
    };
    const direct = parsed.importers?.["apps/server"]?.dependencies;
    if (direct === undefined || parsed.snapshots === undefined) return undefined;
    const visited = new Map<string, unknown>();
    const queue = Object.entries(direct).map(([name, entry]) => `${name}@${entry?.version}`);
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      if (visited.has(key)) continue;
      const snapshot = parsed.snapshots[key];
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

/** The first changed path that makes the release manual, for the release log. */
export function firstRollbackBlocker(evidence: RollbackEvidence): string | undefined {
  const persisted = evidence.changedPaths.find(touchesPersistedSurface);
  if (persisted !== undefined) return persisted;
  if (!evidence.changedPaths.includes("pnpm-lock.yaml")) return undefined;
  const previous = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.previous);
  const current = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.current);
  return previous !== undefined && previous === current ? undefined : "pnpm-lock.yaml";
}

/**
 * A release is rollback-compatible from the previous stable unless it adds a migration, changes
 * a stored event or projection schema, changes the runtime declaration or protocol, or changes
 * the zcp seam. The stored and seam surfaces are the path globs above; a changed lockfile counts
 * only when the server's runtime dependency closure moved. When unsure the rule stays manual.
 */
export function rollbackCompatibility(evidence: RollbackEvidence): RollbackCompatibility {
  const from = evidence.previousTag.startsWith("v") ? evidence.previousTag.slice(1) : "";
  if (
    !stableVersion.test(from) ||
    !stableVersion.test(evidence.candidateVersion) ||
    compareSemverVersions(from, evidence.candidateVersion) >= 0 ||
    !evidence.ancestor ||
    evidence.previousProtocol !== 1 ||
    evidence.currentProtocol !== 1
  ) {
    return MANUAL;
  }
  const previousRuntime = runtimeDeclaration(evidence.previousPackage);
  if (
    previousRuntime === undefined ||
    previousRuntime !== runtimeDeclaration(evidence.currentPackage)
  )
    return MANUAL;
  return firstRollbackBlocker(evidence) === undefined
    ? { rollbackCompatible: true, compatibleFrom: from }
    : MANUAL;
}

/** A failed or incomplete git probe never stamps permission into a release. */
export const readRollbackCompatibility = Effect.fn("readRollbackCompatibility")(
  function* (previousTag: string, candidateVersion: string, cwd?: string) {
    if (!previousTag.startsWith("v") || !stableVersion.test(previousTag.slice(1))) return MANUAL;
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
    if (previousSource === undefined || currentSource === undefined) return MANUAL;
    const ancestor = yield* git(["merge-base", "--is-ancestor", previousSource, currentSource]);
    if (ancestor.code !== 0) return MANUAL;
    const previousProtocol = yield* git([
      "show",
      `${previousTag}:apps/server/update-protocol.json`,
    ]);
    const currentProtocol = yield* git(["show", "HEAD:apps/server/update-protocol.json"]);
    const previousPackage = yield* git(["show", `${previousTag}:apps/server/package.json`]);
    const currentPackage = yield* git(["show", "HEAD:apps/server/package.json"]);
    const changed = yield* git(["diff", "--no-renames", "--name-only", "-z", previousTag, "HEAD"]);
    if (
      [previousProtocol, currentProtocol, previousPackage, currentPackage, changed].some(
        (read) => read.code !== 0,
      )
    )
      return MANUAL;
    const changedPaths = changed.output.split("\0").filter(Boolean);
    const lockChanged = changedPaths.includes("pnpm-lock.yaml");
    const previousLock = lockChanged
      ? yield* git(["show", `${previousTag}:pnpm-lock.yaml`])
      : undefined;
    const currentLock = lockChanged ? yield* git(["show", "HEAD:pnpm-lock.yaml"]) : undefined;
    const evidence: RollbackEvidence = {
      previousTag,
      candidateVersion,
      ancestor: true,
      previousProtocol: Option.getOrUndefined(decodeProtocol(previousProtocol.output))?.protocol,
      currentProtocol: Option.getOrUndefined(decodeProtocol(currentProtocol.output))?.protocol,
      previousPackage: previousPackage.output,
      currentPackage: currentPackage.output,
      changedPaths,
      ...(previousLock?.code === 0 && currentLock?.code === 0
        ? { lockfiles: { previous: previousLock.output, current: currentLock.output } }
        : {}),
    };
    const verdict = rollbackCompatibility(evidence);
    if (!verdict.rollbackCompatible) {
      const blocker = firstRollbackBlocker(evidence);
      yield* Effect.logInfo(
        blocker === undefined
          ? `[release] manual update: ${previousTag} → ${candidateVersion} changes the runtime declaration or protocol`
          : `[release] manual update: ${blocker} changes what ${previousTag} must read back`,
      );
    }
    return verdict;
  },
  Effect.orElseSucceed(() => MANUAL),
);
