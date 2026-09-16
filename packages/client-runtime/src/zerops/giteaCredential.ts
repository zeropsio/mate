/**
 * Giving a Mate what it needs to push — decided, not performed.
 *
 * ## Whose token it is
 *
 * It used to be the Gitea **site admin's**: one user, one token, written into
 * every Mate. A token lifted out of any container reached every repository on
 * the instance, and nothing recorded which Mate had pushed what.
 *
 * Now each Mate has a bot of its own — `mate-{projectId}`, restricted, in its
 * group's readers, and a **collaborator on the repositories it created and no
 * others**. The app asks the org's broker for that bot's token as the person
 * (`authorization/giteaBroker.ts`), and writes the answer onto the Mate's
 * `zcp` service. So a token lifted from one Mate reaches that Mate's
 * repositories, not the group's, and every push has a name on it.
 *
 * The Mate's Zerops key never leaves its container, and no broker endpoint
 * takes one.
 *
 * ## Three variables, and what they mean
 *
 * - `GITEA_URL` (plain) — Gitea's public origin. Not sensitive, so it can be
 *   compared on a read back; a token belongs to the instance that minted it,
 *   so a URL that no longer matches is what makes a token worthless whatever
 *   its value.
 * - `MATE_BROKER_URL` (plain) — where zcp asks for its repositories.
 * - `GITEA_TOKEN` (sensitive) — the bot's. **A sensitive entry reads back as
 *   the literal `REDACTED`** for the token a browser holds (measured
 *   2026-09-06), so this module never compares it to anything. Whether the key
 *   is *there* is the whole signal.
 *
 * ## Ensure never rotates
 *
 * A Mate that already has a token for this Gitea asks for nothing: the broker
 * would answer `minted: false` and there would be nothing to write. Rotation
 * is an explicit action — a compromised Mate, a leaver, a schedule — and so is
 * the one other case that needs a new token: a Mate pointed at a *different*
 * Gitea, whose old token is dead by definition.
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

import type { MateCredentialAnswer, MateCredentialMode } from "../authorization/giteaBroker.ts";

/** Where the Mate's Gitea lives. Not sensitive — comparable on a read back. */
export const GITEA_URL_ENV_KEY = "GITEA_URL";
/** Where zcp asks the broker for a service repository. Not sensitive. */
export const MATE_BROKER_URL_ENV_KEY = "MATE_BROKER_URL";
/** The Mate's bot's access token. Sensitive, so only its presence is observable. */
export const GITEA_TOKEN_ENV_KEY = "GITEA_TOKEN";

/** The scopes the broker mints a bot's token with; its reach is its collaborations. */
export const GITEA_MATE_TOKEN_SCOPES: ReadonlyArray<string> = ["write:repository", "read:user"];

function origin(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

export interface ZeropsGiteaCredentialRequestInput {
  /** Gitea's public origin, from the account's Gitea project. */
  readonly giteaOrigin: string;
  /**
   * The Mate's current `zcp` environment. Sensitive values arrive as
   * `"REDACTED"`; this module reads keys, and compares only the two values it
   * is allowed to believe.
   */
  readonly current: Readonly<Record<string, string>>;
  /** A person asked for a rotation. Never inferred. */
  readonly rotate?: boolean;
}

/**
 * Whether to ask the broker at all, and with which mode — `undefined` when the
 * Mate already has this Gitea's token and nobody asked for a new one.
 *
 * `rotate` for a Mate pointed at another Gitea as well as for an explicit
 * rotation: `ensure` would answer `minted: false` for a bot whose token is
 * live, and the app would then write a URL whose token it does not have.
 */
export function planGiteaCredentialRequest(
  input: ZeropsGiteaCredentialRequestInput,
): MateCredentialMode | undefined {
  if (input.rotate === true) return "rotate";
  const sameInstance = input.current[GITEA_URL_ENV_KEY] === origin(input.giteaOrigin);
  if (!sameInstance) {
    return GITEA_TOKEN_ENV_KEY in input.current ? "rotate" : "ensure";
  }
  return GITEA_TOKEN_ENV_KEY in input.current ? undefined : "ensure";
}

export interface ZeropsGiteaCredentialInput {
  /** The broker's public origin, written into the Mate as `MATE_BROKER_URL`. */
  readonly brokerOrigin: string;
  /** What `POST /mate/credential` answered. */
  readonly credential: MateCredentialAnswer;
  /** The Mate's current `zcp` environment. */
  readonly current: Readonly<Record<string, string>>;
}

export interface ZeropsGiteaCredentialPlan {
  /** Nothing to do: the Mate already has this instance's credential. */
  readonly upToDate: boolean;
  /**
   * Keys to write, in the order they should be written. A write is a delete
   * followed by a create: the platform has no update for a user-data entry.
   */
  readonly write: ReadonlyArray<string>;
  /** Which of them are written `sensitive: true`. */
  readonly sensitive: ReadonlyArray<string>;
  /**
   * The values this plan already knows. `GITEA_TOKEN` is never among them —
   * a plan is progress a UI renders, and the token goes straight from the
   * broker's answer into the write.
   */
  readonly values: Readonly<Record<string, string>>;
  /** A write reaches new processes only, so anything written needs one. */
  readonly restart: boolean;
}

const UP_TO_DATE: ZeropsGiteaCredentialPlan = {
  upToDate: true,
  write: [],
  sensitive: [],
  values: {},
  restart: false,
};

/**
 * What to write onto the Mate's `zcp` service, given what the broker answered
 * and what the Mate already holds.
 *
 * `GITEA_TOKEN` is written exactly when the broker minted one. An `ensure`
 * that found a live token answers `minted: false` and carries no value, and
 * writing the key without one would replace a working credential with nothing.
 */
export function planGiteaCredential(input: ZeropsGiteaCredentialInput): ZeropsGiteaCredentialPlan {
  const giteaUrl = origin(input.credential.url);
  const brokerUrl = origin(input.brokerOrigin);

  const values: Record<string, string> = {};
  const write: Array<string> = [];

  if (input.current[GITEA_URL_ENV_KEY] !== giteaUrl) {
    values[GITEA_URL_ENV_KEY] = giteaUrl;
    write.push(GITEA_URL_ENV_KEY);
  }
  if (input.current[MATE_BROKER_URL_ENV_KEY] !== brokerUrl) {
    values[MATE_BROKER_URL_ENV_KEY] = brokerUrl;
    write.push(MATE_BROKER_URL_ENV_KEY);
  }
  const sensitive: Array<string> = [];
  if (input.credential.minted) {
    write.push(GITEA_TOKEN_ENV_KEY);
    sensitive.push(GITEA_TOKEN_ENV_KEY);
  }

  if (write.length === 0) return UP_TO_DATE;
  return { upToDate: false, write, sensitive, values, restart: true };
}
