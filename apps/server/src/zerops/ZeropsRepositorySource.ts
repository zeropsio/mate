/**
 * ZeropsRepositorySource - which git repositories exist in this Zerops
 * project, and where each one really lives.
 *
 * On Zerops a repository is not a directory inside the workspace: it is a
 * sibling *service*. zcp sshfs-mounts every dev service's `/var/www` at
 * `/var/www/<hostname>` on the container, and the `.git` directory sits on
 * that service's own disk. So each entry here carries both sides of the same
 * repository - the `mountPath` the server and the agent see, and the
 * `remotePath` git must actually run against over SSH.
 *
 * The set is read from the container's own mount table (`/proc/mounts` by
 * default), never a platform call and never a scan of `/var/www` for `.git`:
 * a repository is a `fuse.sshfs` mount whose mountpoint is `/var/www/<host>`
 * and whose mountpoint answers a bounded probe - the same check zcp itself
 * runs (`stat`ing `/var/www/<hostname>`) before it will call a service
 * "mounted". A stale mount-table line for a service that has since gone away
 * fails the probe and is dropped, one mount at a time, without failing the
 * whole read.
 *
 * Three outcomes, deliberately distinct:
 * - `disabled` - not a Zerops environment; nothing to enumerate, nothing to
 *   warn about, and the mount table is never read.
 * - `unavailable` - Zerops, but the mount table could not be read at all
 *   (permissions, `/proc` unmounted, ...). Callers degrade and name the
 *   reason; they must not read it as "this project has no repositories".
 * - `available` - the answer, possibly an empty list, which is the honest
 *   "no repositories yet" of a project with no mounted runtime.
 *
 * @module ZeropsRepositorySource
 */
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

/**
 * How long a mountpoint probe may take before it is treated as a timeout, not
 * a real answer. Matches zcp's own bound before it will report a service
 * `mounted`.
 */
export const MOUNTPOINT_PROBE_TIMEOUT = Duration.seconds(2);

/** One repository: a mounted dev service with its `.git` on its own disk. */
export interface ZeropsRepository {
  /** The service hostname, which is also the SSH host inside the project. */
  readonly host: string;
  /** `/var/www/<host>` - the path the server, the agent and T3 all speak. */
  readonly mountPath: string;
  /** `/var/www` - the path git must run against on `host`. */
  readonly remotePath: string;
}

/** The result of an enumeration. See the module doc for why there are three. */
export type ZeropsRepositories =
  | { readonly _tag: "disabled" }
  | { readonly _tag: "unavailable"; readonly reason: string }
  | { readonly _tag: "available"; readonly repositories: ReadonlyArray<ZeropsRepository> };

/** The mount table could not be read at all - distinct from a stale line failing its probe. */
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

/** A candidate mount, before its probe decides whether it is really reachable. */
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
    const [, mountPoint, fsType] = fields;
    if (fsType !== SSHFS_FSTYPE || mountPoint === undefined || !mountPoint.startsWith(prefix)) {
      continue;
    }
    const host = mountPoint.slice(prefix.length);
    if (host.length === 0 || host.includes("/")) {
      continue;
    }
    candidates.push({ host, mountPath: mountPoint });
  }
  return candidates;
};

/**
 * The one dependency the source has: a mount-table read.
 *
 * `/proc/mounts` in production. Reading it can fail outright (permissions,
 * `/proc` unmounted); it is never expected to omit a real mount, so a
 * successful read is trusted completely - the bounded probe is what tells a
 * live mount from a stale line.
 */
export type ZeropsMountTableReader = Effect.Effect<string, MountTableReadError>;

/**
 * Whether `path` is really mounted right now. Bounded so a wedged fuse
 * mountpoint (the disconnected-service case) cannot hang an enumeration -
 * `stat` with a 2 s timeout in production, matching zcp's own check. Never
 * fails: a timeout and an ordinary "not there" both answer `false`.
 */
export type ZeropsMountpointProbe = (path: string) => Effect.Effect<boolean>;

export interface ZeropsRepositorySourceOptions {
  /** `isZeropsEnvironment(config)`, passed in so the rule has one home. */
  readonly enabled: boolean;
  readonly readMountTable: ZeropsMountTableReader;
  readonly probeMountpoint: ZeropsMountpointProbe;
}

const probeCandidates = (
  candidates: ReadonlyArray<ZeropsMountCandidate>,
  probeMountpoint: ZeropsMountpointProbe,
): Effect.Effect<ReadonlyArray<ZeropsRepository>> =>
  Effect.forEach(
    candidates,
    (candidate) =>
      probeMountpoint(candidate.mountPath).pipe(
        Effect.map((mounted): ZeropsRepository | undefined =>
          mounted
            ? {
                host: candidate.host,
                mountPath: candidate.mountPath,
                remotePath: ZEROPS_REMOTE_REPOSITORY_PATH,
              }
            : undefined,
        ),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((probed) => probed.filter((repository) => repository !== undefined)));

export interface ZeropsRepositorySourceService {
  /** The repository set, re-read when the cached one is older than the TTL. */
  readonly list: Effect.Effect<ZeropsRepositories>;
  /** An unconditional re-read - what a turn start uses. */
  readonly refresh: Effect.Effect<ZeropsRepositories>;
}

export const makeZeropsRepositorySource = Effect.fn("ZeropsRepositorySource.make")(function* (
  options: ZeropsRepositorySourceOptions,
): Effect.fn.Return<ZeropsRepositorySourceService, never, never> {
  const disabled = { _tag: "disabled" } as const;
  if (!options.enabled) {
    const off = Effect.succeed<ZeropsRepositories>(disabled);
    return { list: off, refresh: off };
  }

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
      Effect.map(parseMountTable),
      Effect.flatMap((candidates) => probeCandidates(candidates, options.probeMountpoint)),
      Effect.map((repositories): ZeropsRepositories => ({ _tag: "available", repositories })),
      Effect.catch((error) =>
        Effect.succeed<ZeropsRepositories>({ _tag: "unavailable", reason: error.message }),
      ),
    );

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

  return { list, refresh: gate.withPermits(1)(read) };
});

export class ZeropsRepositorySource extends Context.Service<
  ZeropsRepositorySource,
  ZeropsRepositorySourceService
>()("t3/zerops/ZeropsRepositorySource") {}

/** The live source, reading `/proc/mounts` and `stat`-probing each candidate. */
export const layer = Layer.effect(
  ZeropsRepositorySource,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const enabled = isZeropsEnvironment(config);
    const fileSystem = yield* FileSystem.FileSystem;

    const readMountTable: ZeropsMountTableReader = fileSystem
      .readFileString(MOUNT_TABLE_PATH)
      .pipe(Effect.mapError((cause) => new MountTableReadError({ path: MOUNT_TABLE_PATH, cause })));

    const probeMountpoint: ZeropsMountpointProbe = (path) =>
      fileSystem.stat(path).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
        Effect.timeoutOrElse({
          duration: MOUNTPOINT_PROBE_TIMEOUT,
          orElse: () => Effect.succeed(false),
        }),
      );

    return ZeropsRepositorySource.of(
      yield* makeZeropsRepositorySource({ enabled, readMountTable, probeMountpoint }),
    );
  }),
);
