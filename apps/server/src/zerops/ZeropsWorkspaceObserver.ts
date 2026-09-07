/** Read-only remote observations. No init, fetch, checkout, config or FUSE calls. */
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ServerConfig } from "../config.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "./ZeropsRepositorySource.ts";
import { identityGuard, shellQuote, sshArguments } from "./ZeropsWorkspaceAccess.ts";
export { withRepository } from "./ZeropsWorkspaceAccess.ts";

export interface VerifiedZeropsRepository extends ZeropsRepository {
  readonly identity: { readonly projectId: string; readonly serviceId: string };
  readonly rootId: string;
}
export interface ZeropsGitObservation {
  readonly state: "absent" | "unborn" | "ready" | "unsupported" | "unreadable";
  readonly shallow: boolean;
  readonly head?: string;
  readonly branch?: string;
  readonly gitDir?: string;
  readonly reason?: string;
}
export type ZeropsWorkspaceObservation =
  | {
      readonly _tag: "available";
      readonly repository: VerifiedZeropsRepository;
      readonly git: ZeropsGitObservation;
      readonly observedAt: string;
    }
  | {
      readonly _tag: "unavailable";
      readonly repository: ZeropsRepository;
      readonly reason: string;
      readonly observedAt: string;
    };
export const workspaceRootId = (projectId: string, serviceId: string, remotePath: string): string =>
  `zerops:${NodeCrypto.createHash("sha256")
    .update(JSON.stringify([projectId, serviceId, remotePath]))
    .digest("hex")}`;

/** NUL-delimited fixed fields avoid interpreting file paths or environment as shell code. */
export const workspaceProbeScript = (remotePath: string): string => `
set -eu
[ -n "\${projectId-}" ] && [ -n "\${serviceId-}" ] || exit 125
cd -P ${shellQuote(remotePath)} || exit 124
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1
state=absent; shallow=false; head=; branch=; gitdir=; reason=
if [ -e .git ] || [ -L .git ]; then
  if [ ! -d .git ] || [ -L .git ]; then
    state=unsupported; reason='Git directory is not a service-root directory'
  elif ! gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null); then
    state=unreadable; reason='Git metadata cannot be read'
  elif [ "$gitdir" != "$PWD/.git" ] || [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$PWD" ]; then
    state=unsupported; reason='Git layout is not the service-root worktree'
  elif git config --get extensions.partialClone >/dev/null 2>&1 || git config --get-regexp '^remote\\..*\\.promisor$' >/dev/null 2>&1; then
    state=unsupported; reason='Partial clone requires unsupported object fetching'
  else
    shallow=$(git rev-parse --is-shallow-repository) || exit 123
    branch=$(git symbolic-ref -q --short HEAD 2>/dev/null) || branch=
    if head=$(git rev-parse --verify HEAD^{commit} 2>/dev/null); then state=ready
    elif [ -n "$branch" ]; then
      if git rev-parse --verify HEAD >/dev/null 2>&1; then state=unreadable; reason='HEAD commit is unavailable'
      else state=unborn; head=; fi
    else state=unreadable; head=; reason='HEAD cannot be resolved'; fi
  fi
fi
printf '%s\\0' "${"${projectId}"}" "${"${serviceId}"}" "$state" "$shallow" "$head" "$branch" "$gitdir" "$reason"
`;
const ProbeFields = Schema.Tuple([
  Schema.String,
  Schema.String,
  Schema.Literals(["absent", "unborn", "ready", "unsupported", "unreadable"]),
  Schema.Literals(["true", "false"]),
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.String,
]);
const decodeProbeFields = Schema.decodeUnknownSync(ProbeFields);
export const decodeWorkspaceProbe = (output: string) =>
  decodeProbeFields(output.endsWith("\0") ? output.slice(0, -1).split("\0") : []);

export class WorkspaceProbeError extends Schema.TaggedErrorClass<WorkspaceProbeError>()(
  "WorkspaceProbeError",
  { cause: Schema.Defect() },
) {}
export interface ZeropsWorkspaceObserverOptions {
  readonly projectId: string;
  readonly runProbe: (
    repository: ZeropsRepository,
    command: string,
  ) => Effect.Effect<string, WorkspaceProbeError>;
  readonly remember?: (repository: ZeropsRepository) => Effect.Effect<void>;
}
export const makeZeropsWorkspaceObserver = (options: ZeropsWorkspaceObserverOptions) => {
  const observe = Effect.fn("ZeropsWorkspaceObserver.observe")(function* (
    repository: ZeropsRepository,
  ) {
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const unavailable = (reason: string): ZeropsWorkspaceObservation => ({
      _tag: "unavailable",
      repository,
      reason,
      observedAt,
    });
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/u.test(repository.host) ||
      repository.remotePath !== "/var/www" ||
      repository.mountPath !== `/var/www/${repository.host}`
    )
      return unavailable("Unsupported remote workspace address");
    const command = `${repository.identity ? identityGuard(repository.identity) : ""}exec timeout -k 1 5 sh -c ${shellQuote(workspaceProbeScript(repository.remotePath))}`;
    return yield* Effect.gen(function* () {
      const output = yield* options.runProbe(repository, command);
      const fields = yield* Effect.try(() => decodeWorkspaceProbe(output));
      const [projectId, serviceId, state, shallow, head, branch, gitDir, reason] = fields;
      if (
        !projectId ||
        !serviceId ||
        projectId !== options.projectId ||
        (repository.identity &&
          (repository.identity.projectId !== projectId ||
            repository.identity.serviceId !== serviceId))
      ) {
        return unavailable("Remote project/service identity mismatch");
      }
      const verified: VerifiedZeropsRepository = {
        ...repository,
        identity: { projectId, serviceId },
        rootId: workspaceRootId(projectId, serviceId, repository.remotePath),
      };
      if (repository.rootId !== undefined && repository.rootId !== verified.rootId)
        return unavailable("Remote root binding mismatch");
      if (options.remember) yield* options.remember(verified);
      return {
        _tag: "available",
        repository: verified,
        observedAt,
        git: {
          state,
          shallow: shallow === "true",
          ...(head ? { head } : {}),
          ...(branch ? { branch } : {}),
          ...(gitDir ? { gitDir } : {}),
          ...(reason ? { reason } : {}),
        },
      } satisfies ZeropsWorkspaceObservation;
    }).pipe(
      Effect.timeout("8 seconds"),
      Effect.catch(() => Effect.succeed(unavailable("Remote workspace probe failed or timed out"))),
    );
  });
  return { observe };
};
export class ZeropsWorkspaceObserver extends Context.Service<
  ZeropsWorkspaceObserver,
  ReturnType<typeof makeZeropsWorkspaceObserver>
>()("t3/zerops/ZeropsWorkspaceObserver") {}

export const layer = Layer.effect(
  ZeropsWorkspaceObserver,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const source = yield* ZeropsRepositorySource;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return makeZeropsWorkspaceObserver({
      projectId: config.zerops?.projectId ?? "",
      remember: source.remember,
      runProbe: (repository, command) =>
        Effect.scoped(
          Effect.gen(function* () {
            const process = yield* spawner.spawn(
              ChildProcess.make("ssh", sshArguments(repository.host, command)),
            );
            let bytes = 0;
            const boundedOutput = process.stdout.pipe(
              Stream.mapEffect((chunk) => {
                bytes += chunk.byteLength;
                return bytes > 32_768
                  ? Effect.fail(new WorkspaceProbeError({ cause: "Probe output exceeded 32 KiB" }))
                  : Effect.succeed(chunk);
              }),
            );
            const [output, , code] = yield* Effect.all(
              [Stream.runCollect(boundedOutput), Stream.runDrain(process.stderr), process.exitCode],
              { concurrency: "unbounded" },
            );
            if (code !== 0) return yield* new WorkspaceProbeError({ cause: "SSH probe failed" });
            return new TextDecoder().decode(Buffer.concat(Array.from(output)));
          }),
        ).pipe(Effect.mapError((cause) => new WorkspaceProbeError({ cause }))),
    });
  }),
);
