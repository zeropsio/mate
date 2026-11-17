/**
 * Whether a checkout's remote actually answers — `git ls-remote`, run now.
 *
 * The Git tab may not decide this from anything else (guide 4.5, "each fact
 * from the party that can prove it"). A remote being configured proves
 * nothing: a Mate whose HQ credential was never written has one, and so
 * does a Mate pointed at an instance that no longer exists. The last push
 * proves nothing either — it says the remote answered once. Only asking it
 * says it answers.
 *
 * ## Who asks
 *
 * A dev service holds no Git credential by contract, so a plain `git` there
 * (what `ZeropsGitSpawner` makes of a git spawn under a mount) is refused by
 * an HQ-hosted remote whatever the remote's health. The one party that
 * authenticates a dev checkout's network git is `zcp git <host> …`, run in
 * this container: it runs git in the service over ssh and answers git's
 * credential request over that session with the Mate's project key, storing
 * nothing there (`zeropsio/zcp:docs/spec-mate.md` §6.6, §6.8). So the probe
 * runs `zcp git <host> ls-remote`, `<host>` being the repository whose mount
 * holds the checkout (a lease's host is its alias, which `zcp git` takes).
 *
 * ## What it answers with
 *
 * Whether the remote answered, how many refs it advertised, and — when it did
 * not — git's first diagnostic line. Never the output itself: `ls-remote`
 * prints every ref of every branch, which is a repository's whole shape for
 * an answer to a yes/no question.
 *
 * A remote that refuses is a **successful call** carrying `reachable: false`.
 * The error channel is for a probe that could not be run at all — a checkout
 * under no repository of this Mate, zcp refusing before any ssh call (exit 2),
 * ssh itself failing (exit 255), a timeout — because those need a different
 * sentence and a retry rather than "your remote is down".
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
import { findRepository } from "./ZeropsGitSpawner.ts";
import { ZeropsRepositorySource } from "./ZeropsRepositorySource.ts";

/** The remote asked about when the caller does not name one. */
export const DEFAULT_REMOTE = "origin";

/** The binary. An option only so a test can stand a script in for it. */
export const ZCP_COMMAND = "zcp";

/** zcp refused the call before any ssh call (an unknown host, a bad argv). */
const ZCP_REFUSED_EXIT = 2;
/** ssh itself failed: the service was not reached, so git never answered. */
const SSH_FAILED_EXIT = 255;

/**
 * A remote that has not answered in ten seconds is one the person is waiting
 * on a page for. `ls-remote` against a healthy HQ on the same region answers
 * in well under a second. It also ends a zcp too old to know `git`, which
 * would sit as an MCP server.
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

const nonEmptyLines = (text: string): ReadonlyArray<string> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Git's first useful diagnostic line, trimmed to one line and to a length a
 * row can carry. `remote:`-prefixed lines are the server's own words and are
 * the ones worth showing; anything else falls back to the first line there is.
 */
export function probeDiagnostic(stderr: string): string {
  const lines = nonEmptyLines(stderr);
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
  /** Arguments before `git <host> ls-remote`. Empty for the real binary. */
  readonly baseArgs: ReadonlyArray<string>;
}

export const make = (options: ZeropsGitRemoteProbeOptions) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const source = yield* ZeropsRepositorySource;

    const probe = (
      input: ZeropsGitRemoteProbeInput,
    ): Effect.Effect<ZeropsGitRemoteProbeResult, ZeropsGitRemoteProbeError> =>
      Effect.gen(function* () {
        const remote = input.remote ?? DEFAULT_REMOTE;
        const repositories = yield* source.list;
        const repository =
          repositories._tag === "available"
            ? findRepository(input.cwd, repositories.repositories)
            : undefined;
        if (repository === undefined) {
          return yield* new ZeropsGitRemoteProbeError({
            reason: "not a repository of this Mate",
          });
        }
        const result = yield* processRunner
          .run({
            command: options.command,
            // `--` so a remote named like an option cannot become one, and
            // `--heads` so the answer is branches rather than every tag too.
            args: [
              ...options.baseArgs,
              "git",
              repository.host,
              "ls-remote",
              "--heads",
              "--",
              remote,
            ],
            timeout: PROBE_TIMEOUT,
            maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
            outputMode: "truncate",
            timeoutBehavior: "timedOutResult",
          })
          .pipe(
            Effect.mapError(
              (cause) => new ZeropsGitRemoteProbeError({ reason: cause.message ?? String(cause) }),
            ),
          );
        if (result.timedOut) {
          return yield* new ZeropsGitRemoteProbeError({
            reason: "the remote did not answer in ten seconds",
          });
        }
        if (result.code === 0) {
          return {
            reachable: true,
            remote,
            refCount: probeRefCount(result.stdout),
            detail: null,
          };
        }
        if (result.code === ZCP_REFUSED_EXIT || result.code === SSH_FAILED_EXIT) {
          return yield* new ZeropsGitRemoteProbeError({
            reason: (nonEmptyLines(result.stderr)[0] ?? `exit ${result.code}`).slice(
              0,
              ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS,
            ),
          });
        }
        return {
          reachable: false,
          remote,
          refCount: 0,
          detail: probeDiagnostic(result.stderr),
        };
      });

    return { probe } as const;
  });

export const layer = Layer.effect(
  ZeropsGitRemoteProbe,
  make({ command: ZCP_COMMAND, baseArgs: [] }),
).pipe(Layer.provide(ProcessRunner.layer));
