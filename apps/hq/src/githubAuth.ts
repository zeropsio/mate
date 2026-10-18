/**
 * How HQ acts on GitHub as the organization's own app (`githubApp.ts` makes and keeps it): a token
 * for one repository the app is installed on, for one use, and the bot it writes as. Every
 * GitHub write HQ makes on such a repository goes through this, so it is the app's, never a
 * person's; where the app is not installed, a caller falls back to the repository's kept token.
 *
 * @module githubAuth
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

/** The app's bot: what GitHub shows as the author of what HQ writes. */
export interface GithubBot {
  /** `<slug>[bot]`. */
  readonly login: string;
  /** The bot user's id: commits it authors use `<userId>+<login>@users.noreply.github.com`. */
  readonly userId: number;
}

/**
 * What HQ uses an app token on one repository for, and the permissions GitHub grants it for that
 * and nothing more: each within what the app may do (`GITHUB_APP_PERMISSIONS`).
 */
export const GITHUB_TOKEN_USES = {
  /** Whether the app reaches the repository: nothing of it but its metadata. */
  reach: { metadata: "read" },
  /** Fetching and pushing its branches: a mirror's, an environment's, a release's. */
  git: { contents: "write" },
  /** Its branches, and what its CI says of them: check runs, statuses and workflow runs. */
  ci: { contents: "write", checks: "read", statuses: "read", actions: "read" },
  /** Its pull requests the bot opens, follows and answers on, and their check runs. */
  pullRequests: { pull_requests: "write", checks: "read" },
  /** Its issues the bot answers on: reactions, comments, labels, closing. */
  issues: { issues: "write" },
} as const;
export type GithubTokenUse = keyof typeof GITHUB_TOKEN_USES;

/** GitHub refused or could not be reached for a token. */
export class GithubAuthUnavailable extends Data.TaggedError("GithubAuthUnavailable")<{
  /** `replaced`: GitHub's repository of that name is not the one of the id asked for. */
  readonly reason: "unreachable" | "refused" | "suspended" | "not_installed" | "replaced";
}> {}

export class GithubAuth extends Context.Service<
  GithubAuth,
  {
    /**
     * A token for `repository` (`owner/name`, case-insensitive) while the app is installed on it,
     * reaching that repository alone with the permissions of `use`; `undefined` when HQ has no app
     * or the app does not reach it. Cached per repository and use until shortly before GitHub
     * expires it. With `id` (the repository's id on GitHub, as a remote keeps it), only while the
     * repository of that name is still the one of that id: one deleted and made again is
     * `replaced`, never a token.
     */
    readonly tokenFor: (
      repository: string,
      use: GithubTokenUse,
      id?: string,
    ) => Effect.Effect<Redacted.Redacted | undefined, GithubAuthUnavailable>;
    /** The app's bot, or `undefined` while HQ has no app. */
    readonly bot: Effect.Effect<GithubBot | undefined, GithubAuthUnavailable>;
  }
>()("@t3tools/hq/githubAuth") {}

/** No app: every repository falls back to its kept token. Tests and HQs without an app. */
export const githubAuthAbsentLayer = Layer.succeed(
  GithubAuth,
  GithubAuth.of({
    tokenFor: () => Effect.succeed(undefined),
    bot: Effect.succeed(undefined),
  }),
);
