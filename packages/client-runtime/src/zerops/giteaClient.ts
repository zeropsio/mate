/**
 * Gitea's API, as the person — the calls Mate makes and no others (guide 4.4).
 *
 * One narrow client over the account's Gitea, holding an OAuth2 access token
 * that acts as the signed-in person (`giteaOAuth.ts`). Every answer is
 * therefore already scoped by the rights the broker mirrored from Zerops: a
 * `read` member's `GET /repos/{o}/{r}` comes back with `permissions.push:
 * false`, and *what the person may do* is read from that probe rather than
 * inferred from a role the app happens to know (guide 4.5, "each fact from the
 * party that can prove it").
 *
 * ## Shape
 *
 * `fetch` is injected, so this module reaches no platform global (rule R1) and
 * every call is exercised in tests against a fake. A `404` is an answer, not a
 * failure: `getOrganization` returns `undefined` for one, because "the broker
 * has not made it yet" is the normal state of a group seconds old. Every other
 * non-2xx throws a {@link GiteaApiError} carrying Gitea's own status and
 * message.
 *
 * ## Tokens
 *
 * The token is held by the caller and handed in; this keeps no copy beyond the
 * closure, never logs one and never writes one anywhere. `token` may be a
 * function so a session that refreshes mid-flight does not have to rebuild the
 * client.
 *
 * ## Deadlines
 *
 * Every request is a read, and ends by {@link GITEA_REQUEST_DEADLINE_MS} as a
 * `TimeoutError`, or earlier when the caller's signal ends it. A Gitea that
 * stops answering is then a failure the reader can retry, never a read that
 * holds its place forever (DESIGN §2.D D3).
 *
 * @module giteaClient
 */

/** Gitea's error envelope, as far as anything here depends on it. */
export class GiteaApiError extends Error {
  readonly status: number;
  /** Gitea's own `message`, when it sent one. */
  readonly detail: string | undefined;

  constructor(message: string, status: number, detail?: string | undefined) {
    super(message);
    this.name = "GiteaApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface GiteaOrganization {
  readonly id: number;
  readonly username: string;
  readonly full_name?: string | undefined;
}

/** One tag of a repository — `GET /repos/{o}/{r}/tags`. */
export interface GiteaTag {
  readonly name: string;
  /** The tag object's sha. */
  readonly id?: string | undefined;
  /** An annotated tag's message; empty for a lightweight one. */
  readonly message?: string | undefined;
  readonly commit?: { readonly sha?: string | undefined } | undefined;
}

export interface GiteaClientOptions {
  /** Gitea's public origin. */
  readonly origin: string;
  /** The access token, or a way to read the current one. */
  readonly token: string | (() => string);
  readonly fetch: typeof globalThis.fetch;
  readonly signal?: AbortSignal | undefined;
}

export interface GiteaClient {
  readonly origin: string;

  /** `undefined` while the broker has not made the group's org yet. */
  getOrganization(slug: string): Promise<GiteaOrganization | undefined>;

  /** One page, Gitea's default length; newest first, as Gitea orders them. */
  listTags(owner: string, repo: string): Promise<ReadonlyArray<GiteaTag>>;
}

const API_PREFIX = "/api/v1";
/** One read answers within this, from the moment it is sent. */
export const GITEA_REQUEST_DEADLINE_MS = 15_000;

export function createGiteaClient(options: GiteaClientOptions): GiteaClient {
  const base = `${options.origin.trim().replace(/\/+$/u, "")}${API_PREFIX}`;
  const tokenOf = () => (typeof options.token === "function" ? options.token() : options.token);

  /** Reads one path and its answer with `answer`, both inside a read's deadline. */
  async function send<T>(
    input: { readonly path: string; readonly signal?: AbortSignal | undefined },
    answer: (response: Response) => Promise<T>,
  ): Promise<T> {
    const { signal, done } = withDeadline(input.signal ?? options.signal);
    try {
      const response = await options.fetch(`${base}${input.path}`, {
        headers: { authorization: `Bearer ${tokenOf()}`, accept: "application/json" },
        signal,
      });
      return await answer(response);
    } finally {
      done();
    }
  }

  async function fail(response: Response, what: string): Promise<never> {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : undefined;
    // Gitea's own words, where it sent any: the sentence that says what went wrong.
    const said = detail === undefined || detail.trim().length === 0 ? "" : ` ${detail.trim()}`;
    throw new GiteaApiError(`Gitea refused to ${what}.${said}`, response.status, detail);
  }

  type Request = Parameters<typeof send>[0];

  const json = <T>(input: Request, what: string): Promise<T> =>
    send(input, async (response) => {
      if (!response.ok) return fail(response, what);
      return (await response.json()) as T;
    });

  /** A `404` is the answer "not there", which several callers need to act on. */
  const optional = <T>(input: Request, what: string): Promise<T | undefined> =>
    send(input, async (response) => {
      if (response.status === 404) {
        // Read to its end: a browser logs a cancelled body as an aborted request of the same URL.
        await response.arrayBuffer().catch(() => undefined);
        return undefined;
      }
      if (!response.ok) return fail(response, what);
      return (await response.json()) as T;
    });

  return {
    origin: options.origin,

    getOrganization: (slug) =>
      optional<GiteaOrganization>({ path: `/orgs/${enc(slug)}` }, "read the group"),

    listTags: (owner, repo) =>
      json<ReadonlyArray<GiteaTag>>(
        { path: `/repos/${enc(owner)}/${enc(repo)}/tags` },
        "list the tags",
      ),
  };
}

/**
 * The caller's signal, ended as well by {@link GITEA_REQUEST_DEADLINE_MS} as a `TimeoutError`.
 * `done` lets it and the caller's signal go once the answer has been read.
 */
function withDeadline(caller: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly done: () => void;
} {
  const controller = new AbortController();
  const expire = () => {
    controller.abort(
      new DOMException(
        `Gitea did not answer within ${String(GITEA_REQUEST_DEADLINE_MS / 1000)} s.`,
        "TimeoutError",
      ),
    );
  };
  // @effect-diagnostics-next-line globalTimers:off -- plain promises: a read's deadline, no Effect runtime here.
  const timer = setTimeout(expire, GITEA_REQUEST_DEADLINE_MS);
  const onCaller = () => controller.abort(caller?.reason);
  if (caller?.aborted === true) onCaller();
  else caller?.addEventListener("abort", onCaller, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCaller);
    },
  };
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
