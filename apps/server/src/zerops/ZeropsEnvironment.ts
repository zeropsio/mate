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
 * being defined - the ticket door and the origin allowlist. Callers outside this module must use
 * `isZeropsEnvironment` rather than re-deriving the rule.
 *
 * @module ZeropsEnvironment
 */

/** The public Zerops API host every project answers on unless told otherwise. */
export const DEFAULT_ZEROPS_API_HOST = "api.app-prg1.zerops.io";

/** The REST prefix every public Zerops endpoint sits behind. */
export const ZEROPS_API_PATH_PREFIX = "/api/rest/public";

/** Resolved Zerops settings; present only inside a Zerops project container. */
export interface ZeropsEnvironment {
  /** The project this container belongs to - the membership check's target. */
  readonly projectId: string;
  /** Fully-qualified REST base, e.g. `https://api.app-prg1.zerops.io/api/rest/public`. */
  readonly apiBaseUrl: string;
  /**
   * This container's own public origin (e.g. `https://zcp-26a7-8080.prg1.zerops.app`): the
   * platform's `zeropsSubdomain`, which zcp's launch carries in from the live env store
   * (spec-mate §2.8). The HQ link presents it in its hello; the relay environment-link proof
   * falls back to the linking request when it is absent (`cloud/http.ts`'s
   * `resolveZeropsLinkProofOrigin`).
   */
  readonly publicOrigin: string | undefined;
  /**
   * **The Mate's own Zerops key** (`ZCP_API_KEY`), which zcp already holds in
   * this container and which the platform scopes to this one project at
   * `BASIC_USER`.
   *
   * HQ verifies it when this Mate links. Project reads use the same key; people
   * enter with HQ tickets and receive rights from HQ's access list.
   */
  readonly apiToken: string | undefined;
  /**
   * The HQ the Mate links to (`ZeropsHqLink`): `T3CODE_ZEROPS_HQ_ORIGIN` in development, else
   * {@link DEFAULT_HQ_ORIGIN}. Nothing discovers it (mate-hq `spec/protocol.md`, Conventions "Origin").
   */
  readonly hqOrigin: string;
  /** Additional exact browser origins admitted in development. */
  readonly allowedOrigins?: ReadonlyArray<string>;
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
  readonly hqOrigin?: string | undefined;
  readonly allowedOrigins?: ReadonlyArray<string>;
  readonly hqGitCredentialPath?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly hostname?: string | undefined;
  readonly statusFile?: string | undefined;
  readonly mateUpdateStateFile?: string | undefined;
}

/**
 * The HQ every Mate links to unless development names another (`T3CODE_ZEROPS_HQ_ORIGIN`). The
 * release package declares it as `mate.hqOrigin` (`buildReleaseManifest`) for zcp, which starts
 * before the server and so never inherits {@link publishHqOrigin}'s copy.
 */
export const DEFAULT_HQ_ORIGIN = "https://mate-hq.zerops.io";

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
  const publicOrigin = input.publicOrigin?.trim();
  const apiToken = input.apiToken?.trim();
  const present = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    projectId,
    allowedOrigins: input.allowedOrigins ?? [],
    apiBaseUrl: resolveZeropsApiBaseUrl(input.apiHost),
    publicOrigin: publicOrigin && publicOrigin.length > 0 ? publicOrigin : undefined,
    apiToken: apiToken && apiToken.length > 0 ? apiToken : undefined,
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
