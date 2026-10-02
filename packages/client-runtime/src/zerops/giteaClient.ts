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
 * failure: `getOrganization`, `getRepository` and `readFile` return `undefined`
 * for one, because "the broker has not made it yet" is the normal state of a
 * group seconds old. Every other non-2xx throws a {@link GiteaApiError}
 * carrying Gitea's own status and message.
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

export interface GiteaRepositoryPermissions {
  readonly admin: boolean;
  readonly push: boolean;
  readonly pull: boolean;
}

export interface GiteaRepository {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly default_branch: string;
  readonly private?: boolean | undefined;
  readonly clone_url?: string | undefined;
  readonly html_url?: string | undefined;
  readonly owner?: { readonly login?: string | undefined } | undefined;
  readonly description?: string | undefined;
  readonly updated_at?: string | undefined;
  /** The probe guide 4.5 insists on: what *this person* may do here. */
  readonly permissions?: GiteaRepositoryPermissions | undefined;
}

/** One commit, as a release's contents and a group's history need it. */
export interface GiteaCommit {
  readonly sha: string;
  /** The first line of its message — with squash merges, the task's words. */
  readonly subject: string;
  /** Who Gitea says wrote it. A Mate's squash merge carries the bot. */
  readonly author?: string | undefined;
  /** When it landed, ISO-8601. Absent where Gitea sent no date. */
  readonly at?: string | undefined;
  /**
   * The paths it touched, where the read carries them (a comparison does): what tells a change
   * that no longer merges which of its files `main` moved under it.
   */
  readonly files?: ReadonlyArray<string> | undefined;
}

/** One file a commit touched. */
export interface GiteaCommitFile {
  readonly filename: string;
  /** Gitea's word: `added`, `modified`, `removed`, `renamed`. */
  readonly status: string;
}

/** What a commit changed, as a page showing one needs it. */
export interface GiteaCommitDetail {
  readonly sha: string;
  readonly subject: string;
  readonly files: ReadonlyArray<GiteaCommitFile>;
  readonly additions: number | undefined;
  readonly deletions: number | undefined;
}

/** Gitea's own shape for a commit it is asked about by sha. */
interface GiteaCommitDetailWire {
  readonly sha?: string | undefined;
  readonly commit?: { readonly message?: string | undefined } | undefined;
  readonly files?:
    | ReadonlyArray<{ readonly filename?: string; readonly status?: string }>
    | undefined;
  readonly stats?:
    | { readonly additions?: number | undefined; readonly deletions?: number | undefined }
    | undefined;
}

/** Gitea's own shape for a commit in a listing. */
interface GiteaListCommitWire {
  readonly sha: string;
  readonly commit?:
    | {
        readonly message?: string | undefined;
        readonly author?: { readonly name?: string; readonly date?: string } | undefined;
      }
    | undefined;
  readonly author?: { readonly login?: string | undefined } | null | undefined;
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

  getRepository(owner: string, repo: string): Promise<GiteaRepository | undefined>;
  /** Every repository this person has access to, page by page. */
  listUserRepositories(): Promise<ReadonlyArray<GiteaRepository>>;
  /** One page, Gitea's default length; newest first, as Gitea orders them. */
  listTags(owner: string, repo: string): Promise<ReadonlyArray<GiteaTag>>;

  /**
   * A branch's commits, newest first — the spine a group's history is drawn on.
   *
   * `compareCommits` cannot answer this: it needs two refs and reports what
   * one has that the other does not, which is the right question for a release
   * and the wrong one for "what has happened here".
   */
  listCommits(
    owner: string,
    repo: string,
    options?:
      | { readonly ref?: string | undefined; readonly limit?: number | undefined }
      | undefined,
  ): Promise<ReadonlyArray<GiteaCommit>>;

  /**
   * What one commit changed: the files it touched and how many lines moved.
   *
   * The only read here that goes below a commit's subject. Without it the app
   * could say a change had landed and never say what was in it, which is the
   * one question a diff answers and a list of subjects cannot.
   */
  commitDetail(owner: string, repo: string, sha: string): Promise<GiteaCommitDetail | undefined>;
}

const API_PREFIX = "/api/v1";
/** One read answers within this, from the moment it is sent. */
export const GITEA_REQUEST_DEADLINE_MS = 15_000;
/** Gitea's default page cap; a page this long may have a next one. */
const PAGE_SIZE = 50;
/** More pages than any account here has repositories for; a stop, not a target. */
const MAX_PAGES = 40;

export function createGiteaClient(options: GiteaClientOptions): GiteaClient {
  const base = `${options.origin.trim().replace(/\/+$/u, "")}${API_PREFIX}`;
  const tokenOf = () => (typeof options.token === "function" ? options.token() : options.token);

  /** Reads one path and its answer with `answer`, both inside a read's deadline. */
  async function send<T>(
    input: {
      readonly path: string;
      readonly query?: Readonly<Record<string, string | number | undefined>> | undefined;
      readonly signal?: AbortSignal | undefined;
    },
    answer: (response: Response) => Promise<T>,
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const { signal, done } = withDeadline(input.signal ?? options.signal);
    try {
      const response = await options.fetch(`${base}${input.path}${suffix}`, {
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
    // Gitea's own words, where it sent any: "This pull request has merge
    // conflicts", "The merge is blocked" — the sentence that tells a person
    // what to do. Wrapping it in a generic refusal and dropping the detail is
    // how a failed merge became "Gitea would not merge it" and nothing more
    // (the owner, 2026-09-18).
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

  /**
   * Every page of a list, in order, until one comes back short. Gitea caps a
   * page at its own maximum (50 by default) whatever `limit` asks for, so a
   * page shorter than the one asked for is the last one.
   */
  async function paged<T>(input: Request, what: string): Promise<ReadonlyArray<T>> {
    const items: Array<T> = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const answer = await json<ReadonlyArray<T>>(
        { ...input, query: { ...input.query, limit: PAGE_SIZE, page } },
        what,
      );
      items.push(...answer);
      if (answer.length < PAGE_SIZE) break;
    }
    return items;
  }

  return {
    origin: options.origin,

    getOrganization: (slug) =>
      optional<GiteaOrganization>({ path: `/orgs/${enc(slug)}` }, "read the group"),

    getRepository: (owner, repo) =>
      optional<GiteaRepository>(
        { path: `/repos/${enc(owner)}/${enc(repo)}` },
        "read the repository",
      ),

    listUserRepositories: () =>
      paged<GiteaRepository>({ path: "/user/repos" }, "list your repositories"),

    listTags: (owner, repo) =>
      json<ReadonlyArray<GiteaTag>>(
        { path: `/repos/${enc(owner)}/${enc(repo)}/tags` },
        "list the tags",
      ),

    listCommits: async (owner, repo, listOptions) => {
      const answer = await optional<ReadonlyArray<GiteaListCommitWire>>(
        {
          path: `/repos/${enc(owner)}/${enc(repo)}/commits`,
          query: {
            ...(listOptions?.ref === undefined ? {} : { sha: listOptions.ref }),
            ...(listOptions?.limit === undefined ? {} : { limit: listOptions.limit }),
          },
        },
        "list the commits",
      );
      return (answer ?? []).map((entry) => ({
        sha: entry.sha,
        subject: (entry.commit?.message ?? "").split("\n")[0]?.trim() ?? "",
        author: entry.author?.login ?? entry.commit?.author?.name,
        at: entry.commit?.author?.date,
      }));
    },

    commitDetail: async (owner, repo, sha) => {
      const answer = await optional<GiteaCommitDetailWire>(
        {
          // Gitea carries one commit under `git/commits`; `/commits/{sha}` is
          // GitHub's shape and answers 404 here (measured on 1.27.2,
          // 2026-09-20). `files` and `stats` come back with it when asked for.
          path: `/repos/${enc(owner)}/${enc(repo)}/git/commits/${enc(sha)}`,
          query: { stat: "true", files: "true" },
        },
        "read the commit",
      );
      if (answer === undefined) return undefined;
      return {
        sha: answer.sha ?? sha,
        subject: (answer.commit?.message ?? "").split("\n")[0]?.trim() ?? "",
        files: (answer.files ?? [])
          .filter((file) => (file.filename ?? "").length > 0)
          .map((file) => ({ filename: file.filename ?? "", status: file.status ?? "modified" })),
        additions: answer.stats?.additions,
        deletions: answer.stats?.deletions,
      };
    },
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
