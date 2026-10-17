/**
 * A repository HQ mirrors to GitHub through the organization's app: GitHub's default branch is
 * upstream. HQ pushes its `main` to an empty repository, fast-forwards its own `main` to GitHub's
 * after a merge there, and pushes each open change's head to a branch of its own on GitHub, from
 * which `pullRequests.ts` keeps the change's pull request.
 *
 * @module githubMirror
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SqlError } from "effect/sql/SqlError";

/** What following GitHub's default branch did. */
export type MirrorSync =
  /** Mate's `main` was pushed to an empty repository, or one behind it. */
  | { readonly kind: "pushed"; readonly sha: string }
  /** Mate's `main` moved to GitHub's: a merge or a push there. */
  | { readonly kind: "imported"; readonly from: string; readonly to: string }
  | { readonly kind: "same"; readonly sha: string }
  /** Neither contains the other: nothing moved, and the repository says so. */
  | { readonly kind: "diverged"; readonly mate: string; readonly github: string };

export class GithubMirrorUnavailable extends Data.TaggedError("GithubMirrorUnavailable")<{
  readonly reason: "not_mirrored" | "unreachable" | "refused" | "busy";
  readonly detail?: string;
}> {}

export class GithubMirror extends Context.Service<
  GithubMirror,
  {
    /** `owner/name` on GitHub that HQ's `repo` of `appId` mirrors to through the app, if any. */
    readonly repositoryOf: (
      appId: string,
      repo: string,
    ) => Effect.Effect<string | undefined, SqlError>;
    /** Follow GitHub's default branch (see {@link MirrorSync}). */
    readonly sync: (
      appId: string,
      repo: string,
    ) => Effect.Effect<MirrorSync, GithubMirrorUnavailable | SqlError>;
    /**
     * Push the change's head to its branch on GitHub (`mate/<number>-<slug>`, named once); its
     * name and the sha pushed, or `undefined` where the change has no head or the repo no mirror.
     */
    readonly pushChange: (
      appId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<
      { readonly branch: string; readonly sha: string } | undefined,
      GithubMirrorUnavailable | SqlError
    >;
  }
>()("@t3tools/hq/githubMirror") {}

/** No mirror: nothing is mirrored through an app. Tests and HQs without an app. */
export const githubMirrorAbsentLayer = Layer.succeed(
  GithubMirror,
  GithubMirror.of({
    repositoryOf: () => Effect.succeed(undefined),
    sync: () => Effect.fail(new GithubMirrorUnavailable({ reason: "not_mirrored" })),
    pushChange: () => Effect.succeed(undefined),
  }),
);
