/**
 * How HQ acts on GitHub as the organization's own app (`githubApp.ts` makes and keeps it): an
 * installation token for a repository the app is installed on, and the bot it writes as. Every
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

/** GitHub refused or could not be reached for a token. */
export class GithubAuthUnavailable extends Data.TaggedError("GithubAuthUnavailable")<{
  /** `replaced`: GitHub's repository of that name is not the one of the id asked for. */
  readonly reason: "unreachable" | "refused" | "suspended" | "not_installed" | "replaced";
}> {}

export class GithubAuth extends Context.Service<
  GithubAuth,
  {
    /**
     * An installation token for `repository` (`owner/name`, case-insensitive) while the app is
     * installed on it; `undefined` when HQ has no app or the app does not reach it. Cached until
     * shortly before GitHub expires it. With `id` (the repository's id on GitHub, as a remote
     * keeps it), only while the repository of that name is still the one of that id: one deleted
     * and made again is `replaced`, never a token.
     */
    readonly tokenFor: (
      repository: string,
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
