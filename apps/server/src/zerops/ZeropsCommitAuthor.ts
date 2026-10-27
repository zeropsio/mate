/**
 * Who an automated Mate's commits are by: the task's commit author (`MateTask.commitAuthor`, the
 * organization's GitHub app's bot), written as the repository-local git identity of every working
 * copy the Mate reaches — each mounted dev service's `/var/www`, where its agent commits. The git
 * runs on the dev service itself (`ZeropsGitSpawner` routes it over SSH), never on the mount.
 *
 * Written again at every task's start, so a task from another app finds its own bot. zcp fills an
 * identity only where none is set, so it never writes over this one. A pool container a thread's
 * agent leased keeps its own: it is that thread's working copy, not the Mate's.
 *
 * @module ZeropsCommitAuthor
 */
import type { MateTaskCommitAuthor } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsProcess } from "../vcs/VcsProcess.ts";
import {
  isLeaseRepository,
  ZeropsRepositorySource,
  type ZeropsRepository,
} from "./ZeropsRepositorySource.ts";

/** How long one `git config` on a dev service may take, its SSH included. */
const CONFIG_TIMEOUT_MS = 15_000;

/**
 * The author is not set on every working copy: the dev services (`where`, by host) git refused or
 * could not reach, none named when the working copies could not be listed.
 */
export class CommitAuthorUnset extends Data.TaggedError("CommitAuthorUnset")<{
  readonly where: ReadonlyArray<string>;
}> {}

export class ZeropsCommitAuthor extends Context.Service<
  ZeropsCommitAuthor,
  {
    /** Sets `author` on every working copy; each one git refuses is logged and named. */
    readonly set: (author: MateTaskCommitAuthor) => Effect.Effect<void, CommitAuthorUnset>;
  }
>()("t3/zerops/ZeropsCommitAuthor") {}

export const make = Effect.gen(function* () {
  const source = yield* ZeropsRepositorySource;
  const vcs = yield* VcsProcess;

  const configure = (repository: ZeropsRepository, author: MateTaskCommitAuthor) =>
    Effect.forEach(
      [
        ["user.name", author.name],
        ["user.email", author.email],
      ] as const,
      ([key, value]) =>
        vcs.run({
          operation: "ZeropsCommitAuthor.set",
          command: "git",
          args: ["config", "--local", key, value],
          cwd: repository.mountPath,
          timeoutMs: CONFIG_TIMEOUT_MS,
        }),
      { discard: true },
    ).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning("zerops commit author: a working copy kept its author", {
            host: repository.host,
            error: error.message,
          }),
          repository.host,
        ),
      ),
    );

  const set = (author: MateTaskCommitAuthor) =>
    Effect.gen(function* () {
      const listed = yield* source.list;
      // Not in a Zerops container: no dev service, no working copy of its.
      if (listed._tag === "disabled") return;
      if (listed._tag === "unavailable") {
        yield* Effect.logWarning("zerops commit author: the working copies could not be listed", {
          reason: listed.reason,
        });
        return yield* new CommitAuthorUnset({ where: [] });
      }
      const missed = yield* Effect.forEach(
        listed.repositories.filter((repository) => !isLeaseRepository(repository)),
        (repository) => configure(repository, author),
        { concurrency: "unbounded" },
      );
      const where = missed.filter((host) => host !== undefined);
      if (where.length > 0) return yield* new CommitAuthorUnset({ where });
    });

  return ZeropsCommitAuthor.of({ set });
});

export const layer = Layer.effect(ZeropsCommitAuthor, make);
