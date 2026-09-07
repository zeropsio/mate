/** Kernel attachment observations, independent of remote availability and Git state. */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
export { withRepository } from "./ZeropsWorkspaceAccess.ts";

/** Where zcp mounts every sibling service on the container. */
export const ZEROPS_WORKSPACE_ROOT = "/var/www";

/** Where the repository lives on the service itself - always the same path. */
export const ZEROPS_REMOTE_REPOSITORY_PATH = "/var/www";

/**
 * How long an enumeration stays good. Services are created and mounted by the
 * agent mid-turn, so the window is short; a turn start refreshes explicitly
 * anyway.
 */
export const REPOSITORY_CACHE_TTL = Duration.seconds(30);

/** The mount table this container's kernel maintains. */
export const MOUNT_TABLE_PATH = "/proc/mounts";

/** The fstype zcp mounts every dev service with. */
const SSHFS_FSTYPE = "fuse.sshfs";

/** Access descriptor for a service working root; Git is optional. */
export interface ZeropsRepository {
  /** The service hostname, which is also the SSH host inside the project. */
  readonly host: string;
  /** `/var/www/<host>` - the path the server, the agent and T3 all speak. */
  readonly mountPath: string;
  /** `/var/www` - the path git must run against on `host`. */
  readonly remotePath: string;
  readonly identity?: { readonly projectId: string; readonly serviceId: string };
  readonly rootId?: string;
}

/** The result of an enumeration. See the module doc for why there are three. */
export type ZeropsRepositories =
  | { readonly _tag: "disabled" }
  | { readonly _tag: "unavailable"; readonly reason: string }
  | {
      readonly _tag: "available";
      readonly repositories: ReadonlyArray<ZeropsRepository>;
      readonly limitations?: ReadonlyArray<string>;
    };

/** The mount table could not be read; this is not an empty attachment set. */
export class MountTableReadError extends Schema.TaggedErrorClass<MountTableReadError>()(
  "MountTableReadError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not read the mount table at '${this.path}'`;
  }
}

/** A kernel attachment candidate; remote access and identity remain unverified. */
interface ZeropsMountCandidate {
  readonly host: string;
  readonly mountPath: string;
}

/**
 * Parses `/proc/mounts` (one line per mount: `device mountpoint fstype
 * options dump pass`) into candidate repositories - an sshfs mount whose
 * mountpoint is a direct child of `/var/www`. A line for any other fstype, or
 * for an sshfs mount elsewhere, is not a repository and is dropped here;
 * whether a candidate is REALLY reachable right now is the probe's job, not
 * this parser's.
 */
export const parseMountTable = (text: string): ReadonlyArray<ZeropsMountCandidate> => {
  const prefix = `${ZEROPS_WORKSPACE_ROOT}/`;
  const candidates: Array<ZeropsMountCandidate> = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 3) {
      continue;
    }
    const [source, mountPoint, fsType] = fields;
    if (fsType !== SSHFS_FSTYPE || mountPoint === undefined || !mountPoint.startsWith(prefix)) {
      continue;
    }
    const host = mountPoint.slice(prefix.length);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/u.test(host) ||
      (source !== `${host}:/var/www` && source !== `zerops@${host}:/var/www`)
    ) {
      continue;
    }
    candidates.push({ host, mountPath: mountPoint });
  }
  return candidates;
};

/** A kernel-table read only, never a filesystem probe of the remote mount. */
export type ZeropsMountTableReader = Effect.Effect<string, MountTableReadError>;

export interface ZeropsRepositorySourceOptions {
  readonly enabled: boolean;
  readonly readMountTable: ZeropsMountTableReader;
}

export interface ZeropsRepositorySourceService {
  /** The repository set, re-read when the cached one is older than the TTL. */
  readonly list: Effect.Effect<ZeropsRepositories>;
  /** An unconditional re-read - what a turn start uses. */
  readonly refresh: Effect.Effect<ZeropsRepositories>;
  /** Access hints only; historical membership belongs to the persisted run. */
  readonly known: Effect.Effect<ReadonlyArray<ZeropsRepository>>;
  readonly remember: (repository: ZeropsRepository) => Effect.Effect<void>;
}

export const makeZeropsRepositorySource = Effect.fn("ZeropsRepositorySource.make")(function* (
  options: ZeropsRepositorySourceOptions,
): Effect.fn.Return<ZeropsRepositorySourceService, never, never> {
  const disabled = { _tag: "disabled" } as const;
  if (!options.enabled) {
    const off = Effect.succeed<ZeropsRepositories>(disabled);
    return { list: off, refresh: off, known: Effect.succeed([]), remember: () => Effect.void };
  }

  const remembered = yield* Ref.make<ReadonlyArray<ZeropsRepository>>([]);
  const remember = (repository: ZeropsRepository) =>
    Ref.update(remembered, (previous) => [
      ...previous.filter((entry) => entry.mountPath !== repository.mountPath),
      repository,
    ]);
  const cache = yield* Ref.make<{ value: ZeropsRepositories; readAt: number } | undefined>(
    undefined,
  );
  // Set while an `unavailable` outcome has already been warned about, so a
  // container with an unreadable mount table logs the reason once rather
  // than on every poll; cleared by a successful read so a later outage is
  // heard again.
  const warned = yield* Ref.make(false);
  const gate = yield* Semaphore.make(1);

  const read = Effect.gen(function* () {
    const outcome = yield* options.readMountTable.pipe(
      Effect.map((text): ZeropsRepositories => {
        const candidates = parseMountTable(text);
        const mountCounts = new Map<string, number>();
        for (const line of text.split("\n")) {
          const [, mountPath, type] = line.trim().split(/\s+/u);
          if (type === SSHFS_FSTYPE && mountPath?.startsWith(`${ZEROPS_WORKSPACE_ROOT}/`)) {
            mountCounts.set(mountPath, (mountCounts.get(mountPath) ?? 0) + 1);
          }
        }
        const unambiguous = candidates.filter(
          (candidate) => mountCounts.get(candidate.mountPath) === 1,
        );
        const count = [...mountCounts.values()].reduce((sum, n) => sum + n, 0);
        return {
          _tag: "available",
          repositories: unambiguous.map((candidate) => ({
            ...candidate,
            remotePath: ZEROPS_REMOTE_REPOSITORY_PATH,
          })),
          ...(count > unambiguous.length
            ? {
                limitations: [
                  "Some SSHFS attachments have an unsupported source or ambiguous mountpoint and could not be identified.",
                ],
              }
            : {}),
        };
      }),
      Effect.catch((error) =>
        Effect.succeed<ZeropsRepositories>({ _tag: "unavailable", reason: error.message }),
      ),
    );

    if (outcome._tag === "available") {
      for (const repository of outcome.repositories) {
        // Retain verified bindings across disconnects, but current attachment
        // discovery never asserts that the same hostname still has that identity.
        const entries = yield* Ref.get(remembered);
        if (!entries.some((entry) => entry.mountPath === repository.mountPath)) {
          yield* remember(repository);
        }
      }
    }
    if (outcome._tag === "unavailable") {
      const alreadyWarned = yield* Ref.getAndSet(warned, true);
      if (!alreadyWarned) {
        yield* Effect.logWarning(
          "Zerops mount table unavailable - repositories cannot be enumerated",
          { reason: outcome.reason },
        );
      }
    } else {
      yield* Ref.set(warned, false);
    }

    const readAt = yield* Clock.currentTimeMillis;
    yield* Ref.set(cache, { value: outcome, readAt });
    return outcome;
  });

  const list = gate.withPermits(1)(
    Effect.gen(function* () {
      const cached = yield* Ref.get(cache);
      if (cached !== undefined) {
        const now = yield* Clock.currentTimeMillis;
        if (now - cached.readAt < Duration.toMillis(REPOSITORY_CACHE_TTL)) {
          return cached.value;
        }
      }
      return yield* read;
    }),
  );

  return { list, refresh: gate.withPermits(1)(read), known: Ref.get(remembered), remember };
});

export class ZeropsRepositorySource extends Context.Service<
  ZeropsRepositorySource,
  ZeropsRepositorySourceService
>()("t3/zerops/ZeropsRepositorySource") {}

/** The live source, reading only `/proc/mounts`, never touching FUSE. */
export const layer = Layer.effect(
  ZeropsRepositorySource,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const enabled = isZeropsEnvironment(config);
    const fileSystem = yield* FileSystem.FileSystem;

    const readMountTable: ZeropsMountTableReader = fileSystem
      .readFileString(MOUNT_TABLE_PATH)
      .pipe(Effect.mapError((cause) => new MountTableReadError({ path: MOUNT_TABLE_PATH, cause })));

    return ZeropsRepositorySource.of(
      yield* makeZeropsRepositorySource({ enabled, readMountTable }),
    );
  }),
);
