/**
 * ZeropsEnvironment - the single rule that decides whether this server is
 * running inside a Zerops project container, plus the settings that follow
 * from it.
 *
 * The rule is deliberately one explicit signal: `T3CODE_ZEROPS_PROJECT_ID` is
 * set and non-empty. Nothing else votes. The zcp binary sets it when it starts
 * the mate unit; a laptop, a desktop build and an ordinary `t3 serve` never have
 * it and therefore keep every upstream behaviour untouched. Sniffing the
 * platform-injected `projectId` instead would make the rule two-headed and let
 * a missing value fail silently rather than loudly.
 *
 * Every Zerops-specific behaviour in this server keys off `config.zerops`
 * being defined - the identity door, the origin allowlist, the session
 * lifetime, the startup pairing link. Callers outside this module must use
 * `isZeropsEnvironment` rather than re-deriving the rule.
 *
 * @module ZeropsEnvironment
 */
import * as Duration from "effect/Duration";

/** The public Zerops API host every project answers on unless told otherwise. */
export const DEFAULT_ZEROPS_API_HOST = "api.app-prg1.zerops.io";

/** The REST prefix every public Zerops endpoint sits behind. */
export const ZEROPS_API_PATH_PREFIX = "/api/rest/public";

/**
 * How often the server re-reads who may still be here.
 *
 * A session minted at the throwaway door carries no credential of the caller's
 * to re-present, so nothing about it expires on its own. Instead the server
 * asks HQ's access list on this interval (`ZeropsMateAccessList`), and at once
 * whenever HQ sends a different one, and ends the sessions whose entry
 * changed.
 */
export const DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS = 30;

/**
 * The longest re-check interval any configuration gets.
 *
 * A configured interval stretches the window a removed person keeps their
 * screen for, so it is cut down to this.
 */
export const MAX_ZEROPS_ROLE_RECHECK_SECONDS = 300;

/**
 * The longest a session lives on one proof.
 *
 * Role changes end a session within one re-check, so this is not a security
 * window — it is the promise that nothing runs forever on a credential nobody
 * has looked at since. A day, because a working day is the unit a person
 * notices, and signing in again costs one throwaway.
 */
export const DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Resolved Zerops settings; present only inside a Zerops project container. */
export interface ZeropsEnvironment {
  /** The project this container belongs to - the membership check's target. */
  readonly projectId: string;
  /** Fully-qualified REST base, e.g. `https://api.app-prg1.zerops.io/api/rest/public`. */
  readonly apiBaseUrl: string;
  /**
   * An explicit override for this container's own public origin (e.g.
   * `https://zcp-26a7-8080.prg1.zerops.app`), set via `T3CODE_ZEROPS_PUBLIC_ORIGIN`.
   * Undefined unless an operator configured it; the relay environment-link
   * proof falls back to deriving the origin from the linking request when
   * this is absent (`cloud/http.ts`'s `resolveZeropsLinkProofOrigin`).
   */
  readonly publicOrigin: string | undefined;
  /**
   * **The Mate's own Zerops key** (`ZCP_API_KEY`), which zcp already holds in
   * this container and which the platform scopes to this one project at
   * `BASIC_USER`.
   *
   * It is what lets the server answer questions about *other* people without
   * holding anything of theirs: who is an `ACTIVE` member of the org, and what
   * role this project's `userRoles` gives them. A caller proves who they are
   * with a throwaway that has no rights at all
   * ({@link ./ZeropsThrowawayIdentity.ts}); every right is then looked up with
   * this key.
   *
   * Undefined outside a Zerops container, and on a container old enough not to
   * pass it through. Both the door and the re-check treat that as "cannot
   * answer" — never as "admit".
   */
  readonly apiToken: string | undefined;
  /**
   * See {@link DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS}; never above
   * {@link MAX_ZEROPS_ROLE_RECHECK_SECONDS}.
   */
  readonly roleRecheckInterval: Duration.Duration;
  /** See {@link DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS}. */
  readonly sessionMaxAge: Duration.Duration;
  /**
   * The HQ the Mate links to (`ZeropsHqLink`): `T3CODE_ZEROPS_HQ_ORIGIN` in development, else
   * {@link DEFAULT_HQ_ORIGIN}. Nothing discovers it (spec-mate §3.5).
   */
  readonly hqOrigin: string;
  /**
   * The file the Mate's Git credential is kept in (`ZeropsGitCredentialFile`): `T3CODE_ZEROPS_HQ_GIT_CREDENTIAL`
   * in development, else a file under the server's own secrets. Every process the server starts
   * is told it ({@link publishHqGitCredential}), so zcp reads it from its environment alone.
   * `mate serve` always resolves one; only a hand-built environment in a test leaves it out.
   */
  readonly hqGitCredentialPath?: string | undefined;
  /** This container's service id and hostname, as the platform sets `serviceId` and `hostname`. */
  readonly serviceId: string | undefined;
  readonly hostname: string | undefined;
  /** zcp's status file (`ZCP_STATUS_FILE`), when this zcp writes one. */
  readonly statusFile: string | undefined;
  /** zcp's Mate update state (`ZCP_MATE_UPDATE_STATE_FILE`), written before it switches versions. */
  readonly mateUpdateStateFile: string | undefined;
  /** The platform's live service-environment store; see {@link ZEMBED_ENV_STORE_PATH}. */
  readonly envStorePath: string;
}

/** Raw environment values, before the rule is applied. */
export interface ZeropsEnvironmentInput {
  readonly projectId: string | undefined;
  readonly apiHost: string | undefined;
  readonly publicOrigin?: string | undefined;
  readonly apiToken?: string | undefined;
  readonly roleRecheckSeconds?: number | undefined;
  readonly sessionMaxAgeSeconds?: number | undefined;
  readonly hqOrigin?: string | undefined;
  readonly hqGitCredentialPath?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly hostname?: string | undefined;
  readonly statusFile?: string | undefined;
  readonly mateUpdateStateFile?: string | undefined;
}

/** The HQ every Mate links to unless development names another (`T3CODE_ZEROPS_HQ_ORIGIN`). */
export const DEFAULT_HQ_ORIGIN = "https://hq.zerops.io";

/** The variable that names HQ's origin, to the server and to every process it starts. */
export const HQ_ORIGIN_ENV = "T3CODE_ZEROPS_HQ_ORIGIN";

/**
 * Puts the HQ the Mate links to into `env`, the environment every process the server starts
 * inherits (provider CLIs, and through them zcp, which has no default of its own): one origin
 * for the server and everything it runs.
 */
export const publishHqOrigin = (env: Record<string, string | undefined>, origin: string): void => {
  env[HQ_ORIGIN_ENV] = origin;
};

/** The variable that names the Git credential file, to the server and to every process it starts. */
export const HQ_GIT_CREDENTIAL_ENV = "T3CODE_ZEROPS_HQ_GIT_CREDENTIAL";

/**
 * The file the Mate keeps its Git credential in: the one development names
 * (`T3CODE_ZEROPS_HQ_GIT_CREDENTIAL`), else a file in the server's own secrets directory, which
 * only its user reaches. Nothing outside the server has to name it.
 */
export const resolveHqGitCredentialPath = (named: string | undefined, secretsDir: string): string =>
  named?.trim() || `${secretsDir.replace(/\/+$/u, "")}/hq-git-credential`;

/** Puts the Git credential file into `env`, as {@link publishHqOrigin} does the HQ origin. */
export const publishHqGitCredential = (
  env: Record<string, string | undefined>,
  path: string,
): void => {
  env[HQ_GIT_CREDENTIAL_ENV] = path;
};

/**
 * The container's live service-environment snapshot (`../zcp/internal/mate/mate.go:113-125`):
 * a root-owned, world-readable flat JSON object of string → string the platform rewrites ~2s
 * after a service env change, no restart.
 */
export const ZEMBED_ENV_STORE_PATH = "/etc/zerops-zembed/env.json";

/**
 * Turns a host - the same shape zcp's `ZCP_API_HOST` carries - into the REST
 * base URL. An empty value means production; a bare host gains `https://`; a
 * value that already carries a scheme keeps it, so a devel region or a local
 * stand-in works unchanged.
 */
export const resolveZeropsApiBaseUrl = (apiHost: string | undefined): string => {
  const trimmed = apiHost?.trim() ?? "";
  const withScheme =
    trimmed.length === 0
      ? `https://${DEFAULT_ZEROPS_API_HOST}`
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
  return `${withScheme.replace(/\/+$/, "")}${ZEROPS_API_PATH_PREFIX}`;
};

/**
 * The detection rule. Returns `undefined` for every non-Zerops environment.
 */
export const resolveZeropsEnvironment = (
  input: ZeropsEnvironmentInput,
): ZeropsEnvironment | undefined => {
  const projectId = input.projectId?.trim() ?? "";
  if (projectId.length === 0) {
    return undefined;
  }
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const publicOrigin = input.publicOrigin?.trim();
  const apiToken = input.apiToken?.trim();
  const present = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    projectId,
    apiBaseUrl: resolveZeropsApiBaseUrl(input.apiHost),
    publicOrigin: publicOrigin && publicOrigin.length > 0 ? publicOrigin : undefined,
    apiToken: apiToken && apiToken.length > 0 ? apiToken : undefined,
    roleRecheckInterval: Duration.seconds(
      Math.min(
        positive(input.roleRecheckSeconds, DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS),
        MAX_ZEROPS_ROLE_RECHECK_SECONDS,
      ),
    ),
    sessionMaxAge: Duration.seconds(
      positive(input.sessionMaxAgeSeconds, DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS),
    ),
    hqOrigin: (present(input.hqOrigin) ?? DEFAULT_HQ_ORIGIN).replace(/\/+$/u, ""),
    ...(present(input.hqGitCredentialPath) === undefined
      ? {}
      : { hqGitCredentialPath: present(input.hqGitCredentialPath) }),
    serviceId: present(input.serviceId),
    hostname: present(input.hostname),
    statusFile: present(input.statusFile),
    mateUpdateStateFile: present(input.mateUpdateStateFile),
    envStorePath: ZEMBED_ENV_STORE_PATH,
  };
};

/**
 * The predicate every caller outside this module should use. Takes the shape
 * of a server config rather than the config service itself so pure helpers and
 * tests can ask the same question.
 */
export const isZeropsEnvironment = (config: {
  readonly zerops: ZeropsEnvironment | undefined;
}): boolean => config.zerops !== undefined;
