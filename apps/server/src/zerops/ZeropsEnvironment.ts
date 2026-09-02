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
 * How long a membership decision stays good.
 *
 * The server never stores the caller's Zerops token, and the platform has no
 * endpoint that lists a project's members, so membership cannot be re-verified
 * server-side. Instead this window IS the lifetime of a session minted through
 * the Zerops door: when it lapses the next connect fails and the client
 * re-mints with the Zerops token it already holds, and that re-mint performs
 * the real membership call. Removing a member therefore ends their access
 * within one window.
 */
export const DEFAULT_ZEROPS_MEMBERSHIP_TTL_SECONDS = 900;

/** Resolved Zerops settings; present only inside a Zerops project container. */
export interface ZeropsEnvironment {
  /** The project this container belongs to - the membership check's target. */
  readonly projectId: string;
  /** Fully-qualified REST base, e.g. `https://api.app-prg1.zerops.io/api/rest/public`. */
  readonly apiBaseUrl: string;
  /** Extra browser origins allowed to reach this server, beyond the built-ins. */
  readonly allowedOrigins: ReadonlyArray<string>;
  /** See {@link DEFAULT_ZEROPS_MEMBERSHIP_TTL_SECONDS}. */
  readonly membershipTtl: Duration.Duration;
  /**
   * An explicit override for this container's own public origin (e.g.
   * `https://zcp-26a7-8080.prg1.zerops.app`), set via `T3CODE_ZEROPS_PUBLIC_ORIGIN`.
   * Undefined unless an operator configured it; the relay environment-link
   * proof falls back to deriving the origin from the linking request when
   * this is absent (`cloud/http.ts`'s `resolveZeropsLinkProofOrigin`).
   */
  readonly publicOrigin: string | undefined;
}

/** Raw environment values, before the rule is applied. */
export interface ZeropsEnvironmentInput {
  readonly projectId: string | undefined;
  readonly apiHost: string | undefined;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly membershipTtlSeconds: number | undefined;
  readonly publicOrigin?: string | undefined;
}

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
  const membershipTtlSeconds =
    input.membershipTtlSeconds !== undefined &&
    Number.isFinite(input.membershipTtlSeconds) &&
    input.membershipTtlSeconds > 0
      ? input.membershipTtlSeconds
      : DEFAULT_ZEROPS_MEMBERSHIP_TTL_SECONDS;
  const publicOrigin = input.publicOrigin?.trim();
  return {
    projectId,
    apiBaseUrl: resolveZeropsApiBaseUrl(input.apiHost),
    allowedOrigins: input.allowedOrigins,
    membershipTtl: Duration.seconds(membershipTtlSeconds),
    publicOrigin: publicOrigin && publicOrigin.length > 0 ? publicOrigin : undefined,
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
