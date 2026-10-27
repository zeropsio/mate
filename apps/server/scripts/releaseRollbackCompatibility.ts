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
 * What the previous release reads back, so a change here makes the release manual: stored rows
 * and their migrations, persisted engine and crew events and snapshots, the state directory's
 * files, and the update and startup path that performs the switch and the rollback. A path
 * ending in `/` covers its directory. The rule is a blocklist: every other path, a new one included, is compatible.
 * The server manifest's runtime declaration and the update protocol are compared separately;
 * dependencies are judged by the lockfile closure below.
 */
export const BLOCKING_PATHS: ReadonlyArray<readonly [path: string, reason: string]> = [
  ["apps/server/src/persistence/", "SQL migrations, repositories and their row schemas"],
  ["apps/server/src/engine/store/", "the engine event store, its migrations and projections"],
  ["apps/server/src/engine/domain/command.ts", "persisted engine commands and events"],
  ["apps/server/src/engine/domain/conversationDomain.ts", "the conversation record's codec"],
  ["apps/server/src/engine/domain/evolve.ts", "the fold behind the stored snapshot"],
  ["apps/server/src/engine/domain/state.ts", "the stored snapshot"],
  ["apps/server/src/engine/domain/ids.ts", "derived ids a restart converges on"],
  ["apps/server/src/engine/outbox/", "effect outbox rows"],
  ["apps/server/src/engine/wakes/", "scheduled wake rows"],
  ["apps/server/src/engine/wire/records.ts", "engine wire record rows"],
  ["apps/server/src/usage/UsageOutbox.ts", "usage outbox rows"],
  ["apps/server/src/zerops/ZeropsSetup.ts", "setup rows"],
  ["apps/server/src/zerops/crew/CrewStore.ts", "crew rows"],
  ["apps/server/src/zerops/crew/engine/CrewOwner.ts", "crew rows and their codec"],
  ["apps/server/src/zerops/crew/engine/command.ts", "persisted crew commands"],
  ["apps/server/src/zerops/crew/engine/events.ts", "persisted crew events"],
  ["apps/server/src/zerops/crew/engine/evolve.ts", "the fold behind the stored crew state"],
  ["apps/server/src/zerops/crew/engine/state.ts", "the stored crew state"],
  ["apps/server/src/zerops/crew/engine/importV1Crew.ts", "reads the first crew store"],
  ["packages/contracts/src/engine.ts", "persisted engine event and command payloads"],
  ["packages/contracts/src/orchestration.ts", "persisted orchestration events"],
  ["apps/server/src/provider/Layers/", "adapters write the resume cursor stored per session"],
  ["apps/server/src/config.ts", "the state directory's layout"],
  ["apps/server/src/serverSettings.ts", "settings.json"],
  ["packages/contracts/src/settings.ts", "settings.json"],
  ["apps/server/src/keybindings.ts", "keybindings.json"],
  ["packages/contracts/src/keybindings.ts", "keybindings.json"],
  ["apps/server/src/serverRuntimeState.ts", "server-runtime.json"],
  ["apps/server/src/auth/ServerSecretStore.ts", "the secrets directory"],
  ["apps/server/src/auth/SessionStore.ts", "stored sessions"],
  ["apps/server/src/auth/replayMarkers.ts", "stored replay markers"],
  ["apps/server/src/attachmentPaths.ts", "the attachments directory's layout"],
  ["apps/server/src/attachmentStore.ts", "stored attachments"],
  ["apps/server/src/uploadsFolder.ts", "the uploads index"],
  ["apps/server/src/zerops/ZeropsGitCredentialFile.ts", "the stored git credential"],
  ["apps/server/src/environment/ServerEnvironment.ts", "environment id, epoch, readiness probe"],
  ["apps/server/src/cli/config.ts", "the serve flags and environment zcp starts each release with"],
  ["apps/server/src/update/", "drain, admission fence and native resume across the switch"],
  ["apps/server/src/engine/updateAdmission.ts", "update admission"],
  ["apps/server/src/engine/updateDrain.ts", "update drain"],
  ["apps/server/src/engine/updateIdle.ts", "update idle barrier"],
  ["apps/server/src/RpcUpdateAdmission.ts", "update admission"],
  ["apps/server/src/ws.ts", "refuses changing calls while an update waits"],
  ["apps/server/src/mateUpdateBoot.ts", "update boot"],
  ["apps/server/src/serverRuntimeStartup.ts", "startup"],
  ["apps/server/src/server.ts", "wires startup, the update route and admission"],
  ["apps/server/src/spi/ProviderUpdateSafety.ts", "provider update safety"],
  ["apps/server/src/zerops/mateUpdateHttp.ts", "the update route zcp calls"],
  ["apps/server/src/zerops/ZeropsMateUpdate.ts", "the update service"],
  ["apps/server/src/zerops/mateAutoUpdate.logic.ts", "the automatic update decision"],
  // What the pack inlines, and what the release manifest leaves for npm to resolve.
  ["scripts/lib/cli-external-packages.ts", "the artifact's runtime dependencies"],
  // The versions `catalog:` resolves to in the release manifest.
  ["scripts/lib/resolve-catalog.ts", "the artifact's runtime dependency versions"],
  // The `define` constants baked into dist/bin.mjs.
  ["scripts/lib/public-config.ts", "constants baked into the artifact"],
];

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

/** Changed paths on the blocklist. Tests are not in the artifact; the lockfile is judged separately. */
const blockingPaths = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths.filter(
    (path) =>
      !isTest(path) &&
      BLOCKING_PATHS.some(([blocked]) =>
        blocked.endsWith("/") ? path.startsWith(blocked) : path === blocked,
      ),
  );

const NAMED_BLOCKERS = 20;

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
 * own dependencies), and all transitive snapshots. An app is never inlined: the server links
 * `@t3tools/web` only to build the bundle it serves, so web-only bumps stay out. Tooling-only
 * changes leave it identical; an unreadable lockfile has none.
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
          const linked = resolveLink(from, version.slice("link:".length));
          if (!linked.startsWith("apps/")) pushImporter(linked);
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
 * A release is rollback-compatible from the previous stable unless it changes a blocklisted
 * path, the server's runtime dependency closure, the runtime declaration or the update protocol.
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
  const previous = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.previous);
  const current = evidence.lockfiles && serverRuntimeClosure(evidence.lockfiles.current);
  const lockMoved =
    evidence.changedPaths.includes("pnpm-lock.yaml") &&
    (previous === undefined || previous !== current);
  const blocking = [
    ...blockingPaths(evidence.changedPaths),
    ...(lockMoved
      ? ["pnpm-lock.yaml (the server's runtime dependencies moved or cannot be compared)"]
      : []),
  ];
  if (blocking.length === 0) return undefined;
  const more = blocking.length - NAMED_BLOCKERS;
  return `${blocking.length} changed path(s) the previous release reads back: ${blocking
    .slice(0, NAMED_BLOCKERS)
    .join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export function rollbackCompatibility(evidence: RollbackEvidence): RollbackCompatibility {
  return rollbackBlocker(evidence) === undefined
    ? { rollbackCompatible: true, compatibleFrom: evidence.previousTag.slice(1) }
    : MANUAL;
}

/**
 * The candidate's rollback range over the published stable history: compatibleFrom is the oldest
 * published release R such that every release after R, the candidate included, is
 * rollback-compatible with the one before it, so a Mate several compatible releases behind still
 * updates automatically. The walk stops at the first manual step. A failed or incomplete git
 * probe never stamps permission into a release.
 */
export const readRollbackCompatibility = Effect.fn("readRollbackCompatibility")(
  function* (publishedTags: ReadonlyArray<string>, candidateVersion: string, cwd?: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(ChildProcess.make("git", args, { stderr: "ignore", cwd }));
      const [output, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { output, code };
    }, Effect.scoped);
    /** Why `currentRef` (release `currentVersion`) is not rollback-compatible with `previousTag`. */
    const stepBlocker = Effect.fnUntraced(function* (
      previousTag: string,
      currentRef: string,
      currentVersion: string,
    ) {
      const previousSource = yield* readReleaseSource(previousTag, git);
      const currentSource = yield* readReleaseSource(currentRef, git);
      if (previousSource === undefined || currentSource === undefined)
        return `the release source of ${previousTag} or ${currentRef} cannot be read`;
      const ancestor = yield* git(["merge-base", "--is-ancestor", previousSource, currentSource]);
      if (ancestor.code !== 0) return `${previousTag} is not an ancestor of ${currentRef}`;
      const reads = {
        previousProtocol: yield* git(["show", `${previousTag}:apps/server/update-protocol.json`]),
        currentProtocol: yield* git(["show", `${currentRef}:apps/server/update-protocol.json`]),
        previousPackage: yield* git(["show", `${previousTag}:apps/server/package.json`]),
        currentPackage: yield* git(["show", `${currentRef}:apps/server/package.json`]),
        changed: yield* git(["diff", "--no-renames", "--name-only", "-z", previousTag, currentRef]),
      };
      const failed = Object.entries(reads).find(([, read]) => read.code !== 0);
      if (failed !== undefined) return `git could not read ${failed[0]}`;
      const changedPaths = reads.changed.output.split("\0").filter(Boolean);
      const lockChanged = changedPaths.includes("pnpm-lock.yaml");
      const previousLock = lockChanged
        ? yield* git(["show", `${previousTag}:pnpm-lock.yaml`])
        : undefined;
      const currentLock = lockChanged
        ? yield* git(["show", `${currentRef}:pnpm-lock.yaml`])
        : undefined;
      return rollbackBlocker({
        previousTag,
        candidateVersion: currentVersion,
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
      });
    });
    const history = publishedTags
      .filter(
        (tag) =>
          tag.startsWith("v") &&
          stableVersion.test(tag.slice(1)) &&
          stableVersion.test(candidateVersion) &&
          compareSemverVersions(tag.slice(1), candidateVersion) < 0,
      )
      .toSorted((a, b) => compareSemverVersions(b.slice(1), a.slice(1)));
    if (history.length === 0) {
      yield* Effect.logInfo(
        `[release] manual update: no published stable release precedes ${candidateVersion}`,
      );
      return MANUAL;
    }
    let currentRef = "HEAD";
    let currentVersion = candidateVersion;
    let compatibleFrom: string | undefined;
    for (const tag of history) {
      const blocker = yield* stepBlocker(tag, currentRef, currentVersion);
      if (blocker !== undefined) {
        yield* Effect.logInfo(
          compatibleFrom === undefined
            ? `[release] manual update: ${tag} → ${candidateVersion}: ${blocker}`
            : `[release] rollback-compatible from ${compatibleFrom}; ${tag} → ${currentVersion} is manual: ${blocker}`,
        );
        break;
      }
      compatibleFrom = tag.slice(1);
      currentRef = tag;
      currentVersion = compatibleFrom;
    }
    return compatibleFrom === undefined
      ? MANUAL
      : ({ rollbackCompatible: true, compatibleFrom } as const);
  },
  Effect.orElseSucceed(() => MANUAL),
);
