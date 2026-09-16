/**
 * Whether a checkout's remote actually answers — `git ls-remote`, run now.
 *
 * The Git tab may not decide this from anything else (guide 4.5, "each fact
 * from the party that can prove it"). A remote being configured proves
 * nothing: a Mate whose Gitea credential was never written has one, and so
 * does a Mate pointed at an instance that no longer exists. The last push
 * proves nothing either — it says the remote answered once. Only asking it
 * says it answers.
 *
 * This is the one party that can ask. The checkout lives in the dev
 * container, its credential helper lives beside it, and `ZeropsGitSpawner`
 * already routes every `git` this server runs to the service that owns the
 * repository over SSH — so a `git ls-remote` with the repository's own `cwd`
 * runs where the credential is, and not against the sshfs mount.
 *
 * ## What it answers with
 *
 * Whether the remote answered, how many refs it advertised, and — when it did
 * not — git's first diagnostic line. Never the output itself: `ls-remote`
 * prints every ref of every branch, which is a repository's whole shape for
 * an answer to a yes/no question.
 *
 * A remote that refuses is a **successful call** carrying `reachable: false`.
 * The error channel is for a probe that could not be run at all — no git, no
 * checkout, a timeout — because those need a different sentence and a retry
 * rather than "your remote is down".
 *
 * @module ZeropsGitRemoteProbe
 */
import {
  ZeropsGitRemoteProbeError,
  ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS,
  type ZeropsGitRemoteProbeResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";

/** The remote asked about when the caller does not name one. */
export const DEFAULT_REMOTE = "origin";

/** The binary. An option only so a test can stand a script in for it. */
export const GIT_COMMAND = "git";

/**
 * A remote that has not answered in ten seconds is one the person is waiting
 * on a page for. `ls-remote` against a healthy Gitea on the same region
 * answers in well under a second.
 */
const PROBE_TIMEOUT = Duration.seconds(10);

/** Enough for a few hundred refs; the count is all that leaves this module. */
const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;

export interface ZeropsGitRemoteProbeInput {
  readonly cwd: string;
  readonly remote?: string | undefined;
}

export class ZeropsGitRemoteProbe extends Context.Service<
  ZeropsGitRemoteProbe,
  {
    readonly probe: (
      input: ZeropsGitRemoteProbeInput,
    ) => Effect.Effect<ZeropsGitRemoteProbeResult, ZeropsGitRemoteProbeError>;
  }
>()("t3/zerops/ZeropsGitRemoteProbe") {}

/**
 * Git's first useful diagnostic line, trimmed to one line and to a length a
 * row can carry. `remote:`-prefixed lines are the server's own words and are
 * the ones worth showing; anything else falls back to the first line there is.
 */
export function probeDiagnostic(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const remote = lines.find((line) => line.startsWith("remote:"));
  const first = remote ?? lines[0] ?? "the remote refused";
  return first.slice(0, ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS);
}

/** How many refs `ls-remote` advertised — one per non-empty line. */
export function probeRefCount(stdout: string): number {
  return stdout.split("\n").filter((line) => line.trim().length > 0).length;
}

export interface ZeropsGitRemoteProbeOptions {
  readonly command: string;
  /** Arguments before `ls-remote`. Empty for the real binary. */
  readonly baseArgs: ReadonlyArray<string>;
}

export const make = (options: ZeropsGitRemoteProbeOptions) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;

    const probe = (
      input: ZeropsGitRemoteProbeInput,
    ): Effect.Effect<ZeropsGitRemoteProbeResult, ZeropsGitRemoteProbeError> => {
      const remote = input.remote ?? DEFAULT_REMOTE;
      return processRunner
        .run({
          command: options.command,
          // `--` so a remote named like an option cannot become one, and
          // `--heads` so the answer is branches rather than every tag too.
          args: [...options.baseArgs, "ls-remote", "--heads", "--", remote],
          cwd: input.cwd,
          timeout: PROBE_TIMEOUT,
          maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.mapError(
            (cause) => new ZeropsGitRemoteProbeError({ reason: cause.message ?? String(cause) }),
          ),
          Effect.flatMap(
            (result): Effect.Effect<ZeropsGitRemoteProbeResult, ZeropsGitRemoteProbeError> => {
              if (result.timedOut) {
                return Effect.fail(
                  new ZeropsGitRemoteProbeError({
                    reason: "the remote did not answer in ten seconds",
                  }),
                );
              }
              if (result.code === 0) {
                return Effect.succeed({
                  reachable: true,
                  remote,
                  refCount: probeRefCount(result.stdout),
                  detail: null,
                });
              }
              return Effect.succeed({
                reachable: false,
                remote,
                refCount: 0,
                detail: probeDiagnostic(result.stderr),
              });
            },
          ),
        );
    };

    return { probe } as const;
  });

export const layer = Layer.effect(
  ZeropsGitRemoteProbe,
  make({ command: GIT_COMMAND, baseArgs: [] }),
).pipe(Layer.provide(ProcessRunner.layer));
