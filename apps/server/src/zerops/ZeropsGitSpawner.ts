/**
 * ZeropsGitSpawner - runs git on the service that owns the repository,
 * never against the sshfs mount.
 *
 * On Zerops the working tree the server sees at `/var/www/<host>` is an sshfs
 * mount of another container's `/var/www`. Git over that mount is not slow in
 * a way one can budget for: a single turn costs 12.7 s against 1.37 s over a
 * multiplexed SSH connection, a workspace rescan trips T3's own 15 s timeout,
 * and a first checkpoint on a tree without a `.gitignore` takes four minutes.
 * The measurements are in `docs/internals/zerops/verified.md` (S0.3 / S0.13).
 * So the rule is absolute: **no git process ever runs against a mount path**.
 *
 * The interception sits at `ChildProcessSpawner`, one level below the git
 * driver, because there are three git paths upstream and not one -
 * `GitVcsDriverCore.executeRaw` (cwd form), `GitVcsDriver.gitCommand`
 * (`-C` form), and `RepositoryIdentityResolver` talking to `ProcessRunner`
 * directly. All three bottom out here, so all three are covered without
 * touching a single vcs file.
 *
 * Verified historical bindings remain routable after unmount. Each remote
 * command checks the project and service IDs in the same shell before Git.
 * An unresolved remote location fails instead of falling back to local Git.
 * Non-Git commands and Git outside the remote workspace keep their platform
 * behaviour. Compound Git pipelines involving remote locations are refused.
 *
 * The path map has one rule in both directions: everything T3 hands us is
 * mount-side, everything we hand git is host-side, everything git hands back
 * becomes mount-side again. `/var/www/<host>` <-> `/var/www`.
 *
 * @module ZeropsGitSpawner
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { ServerConfig } from "../config.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  ZeropsRepositorySource,
  type ZeropsRepositories,
  type ZeropsRepository,
} from "./ZeropsRepositorySource.ts";

import {
  CurrentZeropsRepository,
  identityGuard,
  shellQuote,
  SSH_PINNED_OPTIONS,
} from "./ZeropsWorkspaceAccess.ts";
import {
  ZeropsWorkspaceObserver,
  type ZeropsWorkspaceObservation,
} from "./ZeropsWorkspaceObserver.ts";
export { shellQuote, SSH_PINNED_OPTIONS } from "./ZeropsWorkspaceAccess.ts";

/** The user every Zerops container runs its services as. */
export const SSH_USER = "zerops";

/**
 * How many git processes may run against one host at a time.
 *
 * Fan-out across hosts is what makes multi-repo turns cheap - three repos in
 * parallel cost what one does (0.8 s vs 2.3 s sequential) - so the cap is per
 * host and there is none across hosts. Four keeps a single host well inside
 * sshd's default `MaxSessions` of 10 while leaving room for the agent's own
 * SSH use.
 */
export const MAX_GIT_SESSIONS_PER_HOST = 4;

/** The exit code ssh reserves for its own transport failures. */
const SSH_TRANSPORT_EXIT_CODE = 255;

/**
 * The only environment variables that cross the wire.
 *
 * T3 spreads the server's whole `process.env` into every git spawn
 * (`GitVcsDriverCore.ts:748`, `GitVcsDriver.ts:721`). Shipping that to another
 * container would be both wasteful and a way for a credential to leak out of
 * the process that owns it, so only git's own configuration travels; the
 * login shell on the far side supplies the rest.
 */
const ENV_ALLOWLIST_PREFIX = "GIT_";
const ENV_ALLOWLIST_EXACT: ReadonlySet<string> = new Set(["LC_ALL"]);

/**
 * Dropped rather than forwarded: the trace2 monitor writes this to a *local*
 * temp file and `fs.watch`es it, and inotify never fires for host-side changes
 * anyway (S0.4). Forwarding it would have git write a file on the wrong
 * container that nothing ever reads.
 */
const ENV_DENYLIST: ReadonlySet<string> = new Set([
  "GIT_TRACE2_EVENT",
  "GIT_TRACE2",
  "GIT_TRACE2_PERF",
]);

/** Environment variables whose value is a path and therefore gets mapped. */
const PATH_VALUED_ENV: ReadonlySet<string> = new Set([
  "GIT_INDEX_FILE",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
]);

/** Git's own leading options whose value is a path. */
const PATH_VALUED_FLAGS: ReadonlySet<string> = new Set(["--git-dir", "--work-tree", "--namespace"]);

/** A git spawn rewritten into an ssh spawn. */
export interface ZeropsGitInvocation {
  /** Always `ssh`. */
  readonly command: string;
  /** The full ssh argv: options, then the host, then one remote command. */
  readonly args: ReadonlyArray<string>;
  /** The remote command string, kept separate because it is what we log. */
  readonly remoteCommand: string;
  readonly host: string;
  readonly repository: ZeropsRepository;
  /** Whether this argv shape returns an absolute path that needs mapping. */
  readonly mapsStdoutPaths: boolean;
}

const isUnderMount = (candidate: string, repository: ZeropsRepository): boolean =>
  candidate === repository.mountPath || candidate.startsWith(`${repository.mountPath}/`);

const findRepository = (
  candidate: string | undefined,
  repositories: ReadonlyArray<ZeropsRepository>,
): ZeropsRepository | undefined =>
  candidate === undefined || candidate.length === 0
    ? undefined
    : repositories.find((repository) => isUnderMount(candidate, repository));

/** Mount-side to host-side. The inverse of {@link mapRemotePathsToMount}. */
const toRemotePath = (candidate: string, repository: ZeropsRepository): string =>
  isUnderMount(candidate, repository)
    ? `${repository.remotePath}${candidate.slice(repository.mountPath.length)}`
    : candidate;

const escapeForRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Host-side to mount-side, applied to what git printed.
 *
 * Only at a path position - the start of the output, or after a separator,
 * and ending at a separator or a `/`. `worktree list --porcelain -z` uses NUL
 * where everything else uses a newline, and a bare textual replace would also
 * rewrite `/var/wwwroot` and any occurrence inside a commit message.
 */
export const mapRemotePathsToMount = (text: string, repository: ZeropsRepository): string => {
  const pattern = new RegExp(
    `(^|[\\s\\0])${escapeForRegExp(repository.remotePath)}(?=$|/|[\\s\\0])`,
    "g",
  );
  return text.replaceAll(pattern, (_match, prefix: string) => `${prefix}${repository.mountPath}`);
};

interface SpawnShape {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: {
    readonly cwd?: string | undefined;
    readonly env?: Record<string, string | undefined> | undefined;
  };
}

/** Read Git's leading -C options even when configuration flags precede them. */
const gitLocation = (
  spawn: SpawnShape,
): { location: string | undefined; args: ReadonlyArray<string> } => {
  let location = spawn.options.cwd;
  const args: string[] = [];
  for (let i = 0; i < spawn.args.length; i++) {
    const token = spawn.args[i]!;
    if (token === "-C" && spawn.args[i + 1] !== undefined) {
      const next = spawn.args[++i]!;
      if (next !== "")
        location = next.startsWith("/") ? next : location ? `${location}/${next}` : undefined;
      continue;
    }
    args.push(token);
    if (["-c", "--config-env", "--git-dir", "--work-tree", "--namespace"].includes(token)) {
      if (spawn.args[i + 1] !== undefined) args.push(spawn.args[++i]!);
    } else if (!token.startsWith("-") || token === "--") {
      args.push(...spawn.args.slice(i + 1));
      break;
    }
  }
  return { location, args };
};

const mentionsRemoteLocation = (command: ChildProcess.Command): boolean => {
  if (command._tag === "PipedCommand")
    return mentionsRemoteLocation(command.left) || mentionsRemoteLocation(command.right);
  if (command.command !== "git") return false;
  const { location } = gitLocation(command);
  return (
    location?.startsWith("/var/www/") === true ||
    Object.entries(command.options.env ?? {}).some(
      ([key, value]) => PATH_VALUED_ENV.has(key) && value?.startsWith("/var/www/"),
    ) ||
    command.args.some(
      (token, i) =>
        token.startsWith("/var/www/") && PATH_VALUED_FLAGS.has(command.args[i - 1] ?? ""),
    ) ||
    command.args.some((token) =>
      [...PATH_VALUED_FLAGS].some((flag) => token.startsWith(`${flag}=/var/www/`)),
    )
  );
};

/**
 * Decides whether this spawn is a git command inside a mounted repository and,
 * if it is, what to run instead.
 *
 * Returns `undefined` for everything that must pass through untouched - which
 * is every non-git command, and git itself anywhere but inside a mount.
 */
export const rewriteGitSpawn = (
  spawn: SpawnShape,
  repositories: ReadonlyArray<ZeropsRepository>,
): ZeropsGitInvocation | undefined => {
  if (spawn.command !== "git") {
    return undefined;
  }

  const { location, args: rest } = gitLocation(spawn);
  const repository = findRepository(location, repositories);
  if (repository === undefined || location === undefined || location.split("/").includes("..")) {
    return undefined;
  }

  const mappedRest: Array<string> = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) {
      continue;
    }
    const separatorIndex = token.indexOf("=");
    const flag = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
    if (PATH_VALUED_FLAGS.has(flag)) {
      if (separatorIndex === -1) {
        const value = rest[index + 1];
        mappedRest.push(token);
        if (value !== undefined) {
          mappedRest.push(toRemotePath(value, repository));
          index += 1;
        }
      } else {
        mappedRest.push(`${flag}=${toRemotePath(token.slice(separatorIndex + 1), repository)}`);
      }
      continue;
    }
    // Every other token is left verbatim: a pathspec or a commit message that
    // happens to contain a mount path is data, not a location.
    mappedRest.push(token);
  }

  const environment: Array<string> = [];
  for (const [key, value] of Object.entries(spawn.options.env ?? {})) {
    if (value === undefined || ENV_DENYLIST.has(key)) {
      continue;
    }
    if (!key.startsWith(ENV_ALLOWLIST_PREFIX) && !ENV_ALLOWLIST_EXACT.has(key)) {
      continue;
    }
    environment.push(
      `${key}=${PATH_VALUED_ENV.has(key) ? toRemotePath(value, repository) : value}`,
    );
  }

  const remoteTokens = [
    ...(environment.length > 0 ? ["env", ...environment] : []),
    "git",
    "-C",
    toRemotePath(location, repository),
    ...mappedRest,
  ];
  const gitCommand = remoteTokens.map(shellQuote).join(" ");
  const boundedCommand = mappedRest.includes("mate-snapshot")
    ? `timeout -k 2 30 ${gitCommand}`
    : gitCommand;
  const remoteCommand = repository.identity
    ? `${identityGuard(repository.identity)}exec ${boundedCommand}`
    : boundedCommand;

  return {
    command: "ssh",
    args: [
      "-l",
      SSH_USER,
      ...SSH_PINNED_OPTIONS.flatMap((option) => ["-o", option]),
      repository.host,
      remoteCommand,
    ],
    remoteCommand,
    host: repository.host,
    repository,
    mapsStdoutPaths: returnsAbsolutePath(mappedRest),
  };
};

/**
 * The two argv shapes whose stdout is an absolute path.
 *
 * `--git-common-dir` is deliberately not one of them: git answers it
 * *relatively* (`.git`), and both consumers resolve it against the mount-side
 * cwd, which is correct unmapped and keeps the local `realPath` working
 * through the mount.
 */
const returnsAbsolutePath = (args: ReadonlyArray<string>): boolean => {
  const positional: Array<string> = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }
    if (PATH_VALUED_FLAGS.has(token)) {
      // Skip the flag's value, which is a path and not the subcommand.
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      positional.push(token);
    }
  }
  const subcommand = positional[0];
  if (subcommand === "rev-parse") {
    return args.includes("--show-toplevel");
  }
  return subcommand === "worktree" && positional[1] === "list";
};

export interface ZeropsGitSpawnerOptions {
  /** `isZeropsEnvironment(config)` - the one rule, resolved by the caller. */
  readonly enabled: boolean;
  /** The repository set, re-read per spawn behind the source's own TTL. */
  readonly repositories: Effect.Effect<ZeropsRepositories>;
  readonly known?: Effect.Effect<ReadonlyArray<ZeropsRepository>>;
  readonly observe?: (repository: ZeropsRepository) => Effect.Effect<ZeropsWorkspaceObservation>;
  /** The platform spawner every untouched command still goes to. */
  readonly inner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

const decode = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  repository: ZeropsRepository,
): Stream.Stream<Uint8Array, PlatformError.PlatformError> =>
  Stream.unwrap(
    Effect.suspend(() => {
      const decoder = new TextDecoder();
      return Stream.runFold(
        stream,
        () => "",
        (text: string, chunk: Uint8Array) => text + decoder.decode(chunk, { stream: true }),
      ).pipe(
        Effect.map((text) =>
          Stream.fromArray([
            new TextEncoder().encode(mapRemotePathsToMount(text + decoder.decode(), repository)),
          ]),
        ),
      );
    }),
  );

export const makeZeropsGitSpawner = (
  options: ZeropsGitSpawnerOptions,
): ChildProcessSpawner.ChildProcessSpawner["Service"] => {
  if (!options.enabled) {
    return options.inner;
  }

  // One permit pool per host, created on first use. Local to this service
  // instance, so two servers in one process never share a cap.
  const gates = new Map<string, Semaphore.Semaphore>();
  const gateFor = (host: string): Semaphore.Semaphore => {
    const existing = gates.get(host);
    if (existing !== undefined) {
      return existing;
    }
    const created = Semaphore.makeUnsafe(MAX_GIT_SESSIONS_PER_HOST);
    gates.set(host, created);
    return created;
  };

  const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
    Effect.gen(function* () {
      if (command._tag === "PipedCommand" && mentionsRemoteLocation(command)) {
        return yield* PlatformError.badArgument({
          module: "ZeropsGitSpawner",
          method: "spawn",
          description: "Remote Git pipelines require explicit remote execution",
        });
      }
      if (command._tag !== "StandardCommand" || command.command !== "git") {
        return yield* options.inner.spawn(command);
      }

      const repositories = yield* options.repositories;
      const scoped = yield* CurrentZeropsRepository;
      const known = options.known ? yield* options.known : [];
      const candidates = [
        ...(scoped ? [scoped] : []),
        ...known.filter((entry) => entry.identity !== undefined),
        ...(repositories._tag === "available" ? repositories.repositories : []),
        ...known,
      ];
      let invocation = rewriteGitSpawn(command, candidates);
      if (invocation === undefined) {
        if (mentionsRemoteLocation(command)) {
          return yield* Effect.fail(
            PlatformError.badArgument({
              module: "ZeropsGitSpawner",
              method: "spawn",
              description:
                "Remote workspace is not resolved; refusing local Git under the Zerops mount root",
            }),
          );
        }
        return yield* options.inner.spawn(command);
      }
      if (invocation.repository.identity === undefined && options.observe) {
        const observation = yield* options.observe(invocation.repository);
        if (observation._tag === "unavailable")
          return yield* Effect.fail(
            PlatformError.badArgument({
              module: "ZeropsGitSpawner",
              method: "spawn",
              description: observation.reason,
            }),
          );
        invocation = rewriteGitSpawn(command, [observation.repository]);
        if (invocation === undefined)
          return yield* Effect.fail(
            PlatformError.badArgument({
              module: "ZeropsGitSpawner",
              method: "spawn",
              description: "Remote binding changed during resolution",
            }),
          );
      }

      const gate = gateFor(invocation.host);
      yield* Effect.acquireRelease(Semaphore.take(gate, 1), () => Semaphore.release(gate, 1));

      // No cwd: the location travels in the remote `-C`, so the ssh process
      // itself never touches the mount - not even to resolve its own working
      // directory. No env either: what git needs rides in the remote command
      // and the rest belongs to the far side's login shell.
      const { cwd: _cwd, env: _env, extendEnv: _extendEnv, ...passthrough } = command.options;
      const handle = yield* options.inner.spawn(
        ChildProcess.make(invocation.command, invocation.args, passthrough),
      );

      return ChildProcessSpawner.makeHandle({
        ...handle,
        stdout: invocation.mapsStdoutPaths
          ? decode(handle.stdout, invocation.repository)
          : handle.stdout,
        exitCode: handle.exitCode.pipe(
          Effect.tap((code) =>
            code === SSH_TRANSPORT_EXIT_CODE
              ? Effect.logWarning("Zerops git transport failed - git never ran on the service", {
                  host: invocation.host,
                  remoteCommand: invocation.remoteCommand,
                })
              : Effect.void,
          ),
        ),
      });
    });

  return ChildProcessSpawner.make(spawn);
};

/**
 * The decorator layer.
 *
 * It both requires and provides `ChildProcessSpawner`: wired in front of the
 * platform services it wraps the real spawner, and every consumer above it -
 * all three git paths included - gets the wrapped one from a single point.
 */
export const layer = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const inner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const source = yield* ZeropsRepositorySource;
    const observer = yield* ZeropsWorkspaceObserver;
    return makeZeropsGitSpawner({
      enabled: isZeropsEnvironment(config),
      repositories: source.list,
      known: source.known,
      observe: observer.observe,
      inner,
    });
  }),
);
