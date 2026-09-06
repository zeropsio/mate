/**
 * Giving a Mate what it needs to push — decided, not performed.
 *
 * A Mate pushes to the account's Gitea as itself: one Gitea access token per
 * Mate, named `mate/<bot>`, scoped `write:repository`. The token, the instance
 * it belongs to and the repository it is for are ordinary environment
 * variables on the Mate's own `zcp` service, so the agent inherits them the
 * way it inherits everything else.
 *
 * ## What can be read back, and what cannot
 *
 * A service's environment is readable, but **a sensitive entry reads as the
 * literal string `REDACTED`** for the token a browser holds (measured
 * 2026-09-06 on a fresh account; an integration token reads it in clear). So
 * this module never compares a token to anything. It knows only whether the
 * key is *there*, and that is enough:
 *
 * - `GITEA_URL` and `GITEA_REPO` are not sensitive, so they can be compared;
 * - `GITEA_TOKEN` is, so its presence is the whole signal.
 *
 * A token belongs to the instance that minted it, so a `GITEA_URL` that no
 * longer matches makes the token worthless whatever its value — that, and only
 * that, is what forces a fresh mint. A repository that moved is three
 * characters of environment and no new token at all.
 *
 * ## Why a restart is in the plan
 *
 * A service environment write reaches **new processes only** (~15 s, measured
 * 2026-09-06). The Mate server is already running and the agent inherits its
 * boot environment, so nothing arrives until the container restarts. A plan
 * that writes and does not restart is a plan that appears to work.
 *
 * Nothing here reaches a network or a clock (rule R1): the caller performs the
 * steps and owns every failure.
 *
 * @module giteaCredential
 */

/** Where the Mate's Gitea lives. Not sensitive — comparable on a read back. */
export const GITEA_URL_ENV_KEY = "GITEA_URL";
/** The Mate's own access token. Sensitive, so only its presence is observable. */
export const GITEA_TOKEN_ENV_KEY = "GITEA_TOKEN";
/** `<owner>/<name>` of the repository this Mate works in. Not sensitive. */
export const GITEA_REPO_ENV_KEY = "GITEA_REPO";

/** The scope a Mate's token is minted with: git works, `/user` and `/admin` do not. */
export const GITEA_MATE_TOKEN_SCOPES: ReadonlyArray<string> = ["write:repository"];

const TOKEN_NAME_PREFIX = "mate/";

/**
 * What a Mate's token is called in Gitea: `mate/<bot>`.
 *
 * Named after who holds it so a person reading the account's token list can
 * tell whose it is, and so revoking one Mate's access is one obvious row.
 * Gitea deletes a token by this name, not by id, so it is also the handle.
 */
export function giteaTokenName(botName: string): string | undefined {
  const trimmed = botName.trim();
  return trimmed.length === 0 ? undefined : `${TOKEN_NAME_PREFIX}${trimmed}`;
}

export interface ZeropsGiteaCredentialInput {
  /** The Gitea instance's public origin, as the tool project reports it. */
  readonly giteaOrigin: string;
  /** The Mate's name, from its `mate:bot:` tag. */
  readonly botName: string;
  /** `<owner>/<name>`, when this environment has a repository yet. */
  readonly repository?: string | undefined;
  /**
   * The Mate's current `zcp` environment. Sensitive values arrive as
   * `"REDACTED"`; this module reads keys, and only compares the two values it
   * is allowed to believe.
   */
  readonly current: Readonly<Record<string, string>>;
}

export interface ZeropsGiteaCredentialPlan {
  /** Nothing to do: the Mate already has this instance's credential. */
  readonly upToDate: boolean;
  /** Set when a token has to be minted — no usable one is in place. */
  readonly mintTokenNamed?: string;
  /**
   * Keys to write, in the order they should be written. A write is a delete
   * followed by a create: the platform has no update for a user-data entry.
   * `GITEA_TOKEN`'s value is the minted token and is not carried here.
   */
  readonly write: ReadonlyArray<string>;
  /** The values this plan already knows. `GITEA_TOKEN` is never among them. */
  readonly values: Readonly<Record<string, string>>;
  /** A write reaches new processes only, so anything written needs one. */
  readonly restart: boolean;
}

const UP_TO_DATE: ZeropsGiteaCredentialPlan = {
  upToDate: true,
  write: [],
  values: {},
  restart: false,
};

/**
 * What this Mate still needs. `undefined` when it cannot be worked out — a
 * Mate with no name has no token name, and inventing one would mint a token
 * nobody can attribute.
 */
export function planGiteaCredential(
  input: ZeropsGiteaCredentialInput,
): ZeropsGiteaCredentialPlan | undefined {
  const tokenName = giteaTokenName(input.botName);
  if (tokenName === undefined) return undefined;

  const origin = input.giteaOrigin.replace(/\/+$/u, "");
  const sameInstance = input.current[GITEA_URL_ENV_KEY] === origin;
  const hasToken = GITEA_TOKEN_ENV_KEY in input.current;
  // A token is only worth keeping while it still belongs to the instance the
  // Mate is being pointed at.
  const keepToken = hasToken && sameInstance;

  const values: Record<string, string> = {};
  const write: Array<string> = [];

  if (!sameInstance) {
    values[GITEA_URL_ENV_KEY] = origin;
    write.push(GITEA_URL_ENV_KEY);
  }
  if (!keepToken) write.push(GITEA_TOKEN_ENV_KEY);
  if (input.repository !== undefined && input.current[GITEA_REPO_ENV_KEY] !== input.repository) {
    values[GITEA_REPO_ENV_KEY] = input.repository;
    write.push(GITEA_REPO_ENV_KEY);
  }

  if (write.length === 0) return UP_TO_DATE;
  return {
    upToDate: false,
    ...(keepToken ? {} : { mintTokenNamed: tokenName }),
    write,
    values,
    restart: true,
  };
}
