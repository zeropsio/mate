/**
 * How HQ acts on GitHub as the organization's own app (`githubApp.ts` makes and keeps it): a token
 * for one repository the app is installed on, for one use, and the bot it writes as. Every
 * GitHub write HQ makes on such a repository goes through this, so it is the app's, never a
 * person's; where the app is not installed, a caller falls back to the repository's kept token.
 *
 * @module githubAuth
 */
import type { MateTaskCommitAuthor } from "@t3tools/contracts";
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

/** The bot as a commit's author: GitHub shows a commit by this name and address as the bot's. */
export const botCommitAuthor = (bot: GithubBot): MateTaskCommitAuthor => ({
  name: bot.login,
  email: `${String(bot.userId)}+${bot.login}@users.noreply.github.com`,
});

/**
 * What HQ uses an app token on one repository for, and the most GitHub grants it for that: what
 * GitHub documents each of the use's calls needs
 * (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
 */
export const GITHUB_TOKEN_USES = {
  /** Whether the app reaches the repository: nothing of it but its metadata. */
  reach: { metadata: "read" },
  /**
   * Fetching and pushing its branches over HTTPS — a mirror's, an environment's, a release's — and
   * the release's probe of `.github/workflows`: a pushed commit may touch the workflows.
   */
  git: { contents: "write", workflows: "write" },
  /** Its branches, probed for push, and what its CI says of them: check runs, statuses, runs. */
  ci: { contents: "write", checks: "read", statuses: "read", actions: "read" },
  /**
   * Its pull requests the bot opens, follows and answers on, their closing and check runs; the
   * branches an opened one names, which GitHub reads as the repository's contents.
   */
  pullRequests: { contents: "read", pull_requests: "write", issues: "read", checks: "read" },
  /** Merging its pull request: GitHub's merge writes the repository's contents. */
  merge: { contents: "write", pull_requests: "write" },
  /** Its issues the bot answers on: reactions, comments, labels, closing. */
  issues: { issues: "write" },
  /**
   * A Mate's own work on the repository: its branches and pull requests, and what its CI says of
   * them. Never Commit statuses: `mate/gate` is HQ's word, never the agent's.
   */
  agent: {
    contents: "write",
    pull_requests: "write",
    workflows: "write",
    checks: "read",
    actions: "read",
  },
  /** HQ's `mate/gate` on a head a person merges in Mate (`pullRequests.ts`). */
  gate: { statuses: "write" },
} as const;
export type GithubTokenUse = keyof typeof GITHUB_TOKEN_USES;

/**
 * The commit status HQ writes `success` on a head a person merged in Mate, with its `gate` token. A
 * ruleset requiring it from the organization's app lets GitHub merge only such heads.
 */
export const MATE_GATE = "mate/gate";

const LEVELS = ["read", "write", "admin"] as const;

/**
 * The permissions a token for `use` asks GitHub for: each of the use's, lowered to what the
 * installation was `granted`, none it was not granted — GitHub refuses a token asking more.
 * `undefined` where it was granted none of them: no token, since GitHub reads no permissions asked
 * as all of the installation's.
 */
export const askedPermissions = (
  use: GithubTokenUse,
  granted: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined => {
  const asked: Record<string, string> = {};
  for (const [name, wanted] of Object.entries(GITHUB_TOKEN_USES[use])) {
    const has = LEVELS.indexOf(granted[name] as (typeof LEVELS)[number]);
    if (has >= 0) asked[name] = LEVELS[Math.min(has, LEVELS.indexOf(wanted))]!;
  }
  return Object.keys(asked).length === 0 ? undefined : asked;
};

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
     * reaching that repository alone with the permissions of `use` its installation was granted
     * (`askedPermissions`); `undefined` when HQ has no app, the app does not reach it or was
     * granted none of them. Cached per repository and permissions until shortly before GitHub
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
