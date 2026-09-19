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

/**
 * One hit of `GET /repos/issues/search` — an issue or a pull request across
 * every repository the person can see, with the repository named on it. Not
 * a `GiteaPullRequest`: the search carries neither the head nor whether it
 * merges, which is why the overview lists and links, and a project's flow
 * reads each repository's own pull requests.
 */
export interface GiteaIssueSearchHit {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url?: string | undefined;
  readonly user?: { readonly login?: string | undefined } | undefined;
  readonly updated_at?: string | undefined;
  readonly repository?:
    | {
        readonly id?: number | undefined;
        readonly name?: string | undefined;
        readonly owner?: string | undefined;
        readonly full_name?: string | undefined;
      }
    | undefined;
  readonly pull_request?:
    | { readonly merged?: boolean | undefined; readonly draft?: boolean | undefined }
    | null
    | undefined;
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
}

/** One file a commit touched. */
export interface GiteaCommitFile {
  readonly filename: string;
  /** Gitea's word: `added`, `modified`, `removed`, `renamed`. */
  readonly status: string;
}

/**
 * One thing somebody said on a change.
 *
 * Gitea keeps a pull request's conversation on the issue of the same number,
 * so this is `/issues/{index}/comments` rather than anything under `/pulls`.
 * The body is Markdown as it was typed; nothing here renders it.
 */
export interface GiteaIssueComment {
  readonly id: number;
  /** The login that wrote it — a Mate's is `mate-{projectId}`. */
  readonly author: string | undefined;
  readonly avatarUrl: string | undefined;
  readonly body: string;
  /** ISO-8601. */
  readonly at: string | undefined;
}

/** Gitea's own shape for a comment. */
interface GiteaIssueCommentWire {
  readonly id?: number | undefined;
  readonly user?: GiteaUser | undefined;
  readonly body?: string | undefined;
  readonly created_at?: string | undefined;
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

/** Gitea's own shape for a commit inside a comparison. */
interface GiteaCompareCommitWire {
  readonly sha: string;
  readonly commit?: { readonly message?: string | undefined } | undefined;
}

export interface GiteaBranch {
  readonly name: string;
  readonly commit?: { readonly id?: string | undefined } | undefined;
  readonly protected?: boolean | undefined;
  /**
   * Gitea's own answer to "may this person merge into it". The mirror lags a
   * role change by minutes, so this is what decides whether the app merges its
   * own pull request — never the role the app happens to know (guide 4.5).
   */
  readonly user_can_merge?: boolean | undefined;
  readonly user_can_push?: boolean | undefined;
}

export interface GiteaFile {
  readonly path: string;
  /** Decoded. Gitea sends base64; nothing downstream wants that. */
  readonly content: string;
  /** The blob sha, which an update of this file has to quote. */
  readonly sha: string;
}

/** One entry of `POST /repos/{o}/{r}/contents`'s `files[]`. */
export interface GiteaFileChange {
  readonly operation: "create" | "update" | "delete";
  readonly path: string;
  /** Plain text; encoded on the way out. Omitted for a delete. */
  readonly content?: string | undefined;
  /** Required by Gitea for `update` and `delete`. */
  readonly sha?: string | undefined;
}

export interface GiteaPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url?: string | undefined;
  readonly mergeable?: boolean | undefined;
  readonly merged?: boolean | undefined;
  readonly head?: { readonly ref?: string | undefined; readonly sha?: string | undefined };
  readonly base?: { readonly ref?: string | undefined };
  readonly user?: { readonly login?: string | undefined } | undefined;
  readonly updated_at?: string | undefined;
}

/** One tag of a repository — `GET /repos/{o}/{r}/tags`. */
export interface GiteaTag {
  readonly name: string;
  /** An annotated tag's message; empty for a lightweight one. */
  readonly message?: string | undefined;
  readonly commit?: { readonly sha?: string | undefined } | undefined;
}

export interface GiteaCommitStatus {
  readonly context: string;
  readonly state: "pending" | "success" | "error" | "failure" | "warning";
  readonly description?: string | undefined;
  readonly target_url?: string | undefined;
  readonly created_at?: string | undefined;
}

/**
 * A commit status as Gitea sends it: the state travels under `status`, not
 * `state`. Read as `state` here, every release read as "Checking" and every
 * check as none (the owner's Git tab, 2026-09-17, on a release the broker had
 * approved an hour before).
 */
interface GiteaCommitStatusWire extends Omit<GiteaCommitStatus, "state"> {
  readonly status?: GiteaCommitStatus["state"] | undefined;
  readonly state?: GiteaCommitStatus["state"] | undefined;
}

function commitStatusFromWire(wire: GiteaCommitStatusWire): GiteaCommitStatus {
  const { status, state, ...rest } = wire;
  return { ...rest, state: state ?? status ?? "pending" };
}

/** A comment as the surfaces want it: who, what, when, and nothing else. */
function issueComment(wire: GiteaIssueCommentWire): GiteaIssueComment {
  return {
    id: wire.id ?? 0,
    author: wire.user?.login,
    avatarUrl: wire.user?.avatar_url,
    body: wire.body ?? "",
    at: wire.created_at,
  };
}

export interface GiteaActionRun {
  readonly id: number;
  readonly status?: string | undefined;
  readonly conclusion?: string | undefined;
  readonly head_branch?: string | undefined;
  readonly head_sha?: string | undefined;
  readonly run_number?: number | undefined;
}

export interface GiteaActionJob {
  readonly id: number;
  readonly name?: string | undefined;
  readonly status?: string | undefined;
  readonly conclusion?: string | undefined;
  readonly run_id?: number | undefined;
}

export interface GiteaUser {
  readonly id: number;
  readonly login: string;
  readonly full_name?: string | undefined;
  readonly avatar_url?: string | undefined;
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
  /** The escape hatch, typed — for a call the next slice adds before this one does. */
  request<T>(input: {
    readonly method: string;
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | undefined>> | undefined;
    readonly body?: unknown;
    readonly signal?: AbortSignal | undefined;
  }): Promise<T>;

  currentUser(): Promise<GiteaUser>;

  /** `undefined` while the broker has not made the group's org yet. */
  getOrganization(slug: string): Promise<GiteaOrganization | undefined>;

  getRepository(owner: string, repo: string): Promise<GiteaRepository | undefined>;
  /** Every repository of an org, page by page — the group's own and its services'. */
  listOrganizationRepositories(org: string): Promise<ReadonlyArray<GiteaRepository>>;
  /** Every repository this person has access to, page by page. */
  listUserRepositories(): Promise<ReadonlyArray<GiteaRepository>>;
  /**
   * The pull requests across every repository the person can see, page by
   * page — open ones unless told otherwise, one org's when `owner` is given.
   */
  searchPullRequests(
    options?:
      | { readonly state?: "open" | "closed" | "all"; readonly owner?: string | undefined }
      | undefined,
  ): Promise<ReadonlyArray<GiteaIssueSearchHit>>;
  listBranches(owner: string, repo: string): Promise<ReadonlyArray<GiteaBranch>>;
  /** `undefined` when the branch is not there — a group repo with no `main` yet. */
  getBranch(owner: string, repo: string, branch: string): Promise<GiteaBranch | undefined>;

  /** `undefined` when the path is not in that ref — an empty group repo, say. */
  readFile(
    owner: string,
    repo: string,
    path: string,
    ref?: string | undefined,
  ): Promise<GiteaFile | undefined>;
  changeFiles(
    owner: string,
    repo: string,
    change: {
      readonly files: ReadonlyArray<GiteaFileChange>;
      readonly message: string;
      /** The branch written to; it must exist. */
      readonly branch?: string | undefined;
      /** Created from `branch` and written to instead, when given. */
      readonly newBranch?: string | undefined;
    },
  ): Promise<void>;

  listPullRequests(
    owner: string,
    repo: string,
    options?: { readonly state?: "open" | "closed" | "all" } | undefined,
  ): Promise<ReadonlyArray<GiteaPullRequest>>;
  createPullRequest(
    owner: string,
    repo: string,
    input: {
      readonly head: string;
      readonly base: string;
      readonly title: string;
      readonly body?: string | undefined;
    },
  ): Promise<GiteaPullRequest>;
  mergePullRequest(
    owner: string,
    repo: string,
    index: number,
    input?: { readonly style?: "merge" | "rebase" | "squash"; readonly title?: string } | undefined,
  ): Promise<void>;

  /** What has been said on a change, oldest first — Gitea's own order. */
  listIssueComments(
    owner: string,
    repo: string,
    index: number,
  ): Promise<ReadonlyArray<GiteaIssueComment>>;
  /** Says something on a change, as the person. */
  createIssueComment(
    owner: string,
    repo: string,
    index: number,
    body: string,
  ): Promise<GiteaIssueComment>;

  createTag(
    owner: string,
    repo: string,
    input: {
      readonly tag: string;
      readonly target: string;
      readonly message?: string | undefined;
    },
  ): Promise<void>;

  /** Newest first, as Gitea orders them. */
  listTags(owner: string, repo: string): Promise<ReadonlyArray<GiteaTag>>;

  listCommitStatuses(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<ReadonlyArray<GiteaCommitStatus>>;

  /**
   * The commits `head` has and `base` does not — what a release would carry.
   * Empty where the two are the same commit or Gitea cannot compare them.
   */
  compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<ReadonlyArray<GiteaCommit>>;

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

  listActionRuns(
    owner: string,
    repo: string,
    options?: { readonly branch?: string; readonly limit?: number } | undefined,
  ): Promise<ReadonlyArray<GiteaActionRun>>;
  listActionJobs(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<ReadonlyArray<GiteaActionJob>>;
  rerunActionJob(owner: string, repo: string, jobId: number): Promise<void>;
  actionJobLogs(owner: string, repo: string, jobId: number): Promise<string>;
}

const API_PREFIX = "/api/v1";
/** Gitea's default page cap; a page this long may have a next one. */
const PAGE_SIZE = 50;
/** More pages than any account here has repositories for; a stop, not a target. */
const MAX_PAGES = 40;

export function createGiteaClient(options: GiteaClientOptions): GiteaClient {
  const base = `${options.origin.trim().replace(/\/+$/u, "")}${API_PREFIX}`;
  const tokenOf = () => (typeof options.token === "function" ? options.token() : options.token);

  async function send(input: {
    readonly method: string;
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | undefined>> | undefined;
    readonly body?: unknown;
    readonly accept?: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<Response> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const signal = input.signal ?? options.signal;
    return options.fetch(`${base}${input.path}${suffix}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${tokenOf()}`,
        accept: input.accept ?? "application/json",
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      ...(signal === undefined ? {} : { signal }),
    });
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

  async function json<T>(input: Parameters<typeof send>[0], what: string): Promise<T> {
    const response = await send(input);
    if (!response.ok) return fail(response, what);
    return (await response.json()) as T;
  }

  /** A `404` is the answer "not there", which several callers need to act on. */
  async function optional<T>(
    input: Parameters<typeof send>[0],
    what: string,
  ): Promise<T | undefined> {
    const response = await send(input);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) return fail(response, what);
    return (await response.json()) as T;
  }

  async function nothing(input: Parameters<typeof send>[0], what: string): Promise<void> {
    const response = await send(input);
    if (!response.ok) await fail(response, what);
  }

  /**
   * Every page of a list, in order, until one comes back short. Gitea caps a
   * page at its own maximum (50 by default) whatever `limit` asks for, so a
   * page shorter than the one asked for is the last one.
   */
  async function paged<T>(
    input: Parameters<typeof send>[0],
    what: string,
  ): Promise<ReadonlyArray<T>> {
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
    request: (input) => json(input, `answer ${input.method} ${input.path}`),

    currentUser: () => json<GiteaUser>({ method: "GET", path: "/user" }, "say who you are"),

    getOrganization: (slug) =>
      optional<GiteaOrganization>({ method: "GET", path: `/orgs/${enc(slug)}` }, "read the group"),

    getRepository: (owner, repo) =>
      optional<GiteaRepository>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}` },
        "read the repository",
      ),

    listOrganizationRepositories: (org) =>
      paged<GiteaRepository>(
        { method: "GET", path: `/orgs/${enc(org)}/repos` },
        "list the org's repositories",
      ),

    listUserRepositories: () =>
      paged<GiteaRepository>({ method: "GET", path: "/user/repos" }, "list your repositories"),

    searchPullRequests: (searchOptions) =>
      paged<GiteaIssueSearchHit>(
        {
          method: "GET",
          path: "/repos/issues/search",
          query: {
            type: "pulls",
            state: searchOptions?.state ?? "open",
            owner: searchOptions?.owner,
          },
        },
        "search the pull requests",
      ),

    listBranches: (owner, repo) =>
      json<ReadonlyArray<GiteaBranch>>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/branches` },
        "list the branches",
      ),

    getBranch: (owner, repo, branch) =>
      optional<GiteaBranch>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(branch)}` },
        "read the branch",
      ),

    readFile: async (owner, repo, path, ref) => {
      const answer = await optional<{
        readonly content?: unknown;
        readonly sha?: unknown;
        readonly encoding?: unknown;
      }>(
        {
          method: "GET",
          path: `/repos/${enc(owner)}/${enc(repo)}/contents/${encodePath(path)}`,
          ...(ref === undefined ? {} : { query: { ref } }),
        },
        "read the file",
      );
      if (answer === undefined) return undefined;
      if (typeof answer.content !== "string" || typeof answer.sha !== "string") return undefined;
      return { path, sha: answer.sha, content: base64Decode(answer.content) };
    },

    changeFiles: (owner, repo, change) =>
      nothing(
        {
          method: "POST",
          path: `/repos/${enc(owner)}/${enc(repo)}/contents`,
          body: {
            message: change.message,
            files: change.files.map((file) => ({
              operation: file.operation,
              path: file.path,
              ...(file.content === undefined ? {} : { content: base64Encode(file.content) }),
              ...(file.sha === undefined ? {} : { sha: file.sha }),
            })),
            ...(change.branch === undefined ? {} : { branch: change.branch }),
            ...(change.newBranch === undefined ? {} : { new_branch: change.newBranch }),
          },
        },
        "write the files",
      ),

    listPullRequests: (owner, repo, listOptions) =>
      json<ReadonlyArray<GiteaPullRequest>>(
        {
          method: "GET",
          path: `/repos/${enc(owner)}/${enc(repo)}/pulls`,
          query: { state: listOptions?.state ?? "open" },
        },
        "list the pull requests",
      ),

    createPullRequest: (owner, repo, input) =>
      json<GiteaPullRequest>(
        {
          method: "POST",
          path: `/repos/${enc(owner)}/${enc(repo)}/pulls`,
          body: {
            head: input.head,
            base: input.base,
            title: input.title,
            ...(input.body === undefined ? {} : { body: input.body }),
          },
        },
        "open the pull request",
      ),

    mergePullRequest: (owner, repo, index, input) =>
      nothing(
        {
          method: "POST",
          path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/merge`,
          body: {
            // Squash, because a pull request here is one task: its title is
            // what the person asked for, its commits are the agent's working
            // steps, and `main` reads as the list of tasks delivered rather
            // than as the inside of each one (the owner, 2026-09-18).
            Do: input?.style ?? "squash",
            ...(input?.title === undefined ? {} : { MergeTitleField: input.title }),
          },
        },
        "merge the pull request",
      ),

    listIssueComments: async (owner, repo, index) => {
      const wire = await json<ReadonlyArray<GiteaIssueCommentWire>>(
        {
          method: "GET",
          path: `/repos/${enc(owner)}/${enc(repo)}/issues/${index}/comments`,
        },
        "list what was said on the change",
      );
      return wire.map(issueComment);
    },

    createIssueComment: async (owner, repo, index, body) =>
      issueComment(
        await json<GiteaIssueCommentWire>(
          {
            method: "POST",
            path: `/repos/${enc(owner)}/${enc(repo)}/issues/${index}/comments`,
            body: { body },
          },
          "say that on the change",
        ),
      ),

    createTag: (owner, repo, input) =>
      nothing(
        {
          method: "POST",
          path: `/repos/${enc(owner)}/${enc(repo)}/tags`,
          body: {
            tag_name: input.tag,
            target: input.target,
            ...(input.message === undefined ? {} : { message: input.message }),
          },
        },
        "create the tag",
      ),

    listTags: (owner, repo) =>
      json<ReadonlyArray<GiteaTag>>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/tags` },
        "list the tags",
      ),

    listCommitStatuses: async (owner, repo, sha) =>
      (
        await json<ReadonlyArray<GiteaCommitStatusWire>>(
          { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}/statuses` },
          "list the commit statuses",
        )
      ).map(commitStatusFromWire),

    compareCommits: async (owner, repo, base, head) => {
      if (base === head || base === "" || head === "") return [];
      const answer = await optional<{ readonly commits?: ReadonlyArray<GiteaCompareCommitWire> }>(
        {
          method: "GET",
          // Gitea takes the two refs as one path segment, `base...head`, and
          // answers `404` for a pair it cannot compare — a commit the
          // repository has lost, a fork with no common history.
          path: `/repos/${enc(owner)}/${enc(repo)}/compare/${enc(base)}...${enc(head)}`,
        },
        "compare the commits",
      );
      return (answer?.commits ?? []).map((entry) => ({
        sha: entry.sha,
        subject: (entry.commit?.message ?? "").split("\n")[0]?.trim() ?? "",
      }));
    },

    listCommits: async (owner, repo, listOptions) => {
      const answer = await optional<ReadonlyArray<GiteaListCommitWire>>(
        {
          method: "GET",
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
          method: "GET",
          // `files` and `stats` come back on the repository's own commit
          // endpoint; `git/commits` answers the object without either.
          path: `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}`,
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

    listActionRuns: (owner, repo, listOptions) =>
      json<{ readonly workflow_runs?: ReadonlyArray<GiteaActionRun> }>(
        {
          method: "GET",
          path: `/repos/${enc(owner)}/${enc(repo)}/actions/runs`,
          query: {
            ...(listOptions?.branch === undefined ? {} : { branch: listOptions.branch }),
            ...(listOptions?.limit === undefined ? {} : { limit: listOptions.limit }),
          },
        },
        "list the runs",
      ).then((answer) => answer.workflow_runs ?? []),

    listActionJobs: (owner, repo, runId) =>
      json<{ readonly jobs?: ReadonlyArray<GiteaActionJob> }>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/actions/runs/${runId}/jobs` },
        "list the jobs",
      ).then((answer) => answer.jobs ?? []),

    rerunActionJob: (owner, repo, jobId) =>
      nothing(
        { method: "POST", path: `/repos/${enc(owner)}/${enc(repo)}/actions/jobs/${jobId}/rerun` },
        "rerun the job",
      ),

    actionJobLogs: async (owner, repo, jobId) => {
      const response = await send({
        method: "GET",
        path: `/repos/${enc(owner)}/${enc(repo)}/actions/jobs/${jobId}/logs`,
        accept: "text/plain",
      });
      if (!response.ok) await fail(response, "hand over the logs");
      return response.text();
    },
  };
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** A file path keeps its separators; every other character is escaped. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * UTF-8 text to standard base64, written out for the same reason
 * `base64UrlEncode` is: `btoa` is a platform global this package may not read,
 * and it mangles anything outside Latin-1 besides.
 */
export function base64Encode(text: string): string {
  const bytes = utf8Bytes(text);
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : BASE64_ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : BASE64_ALPHABET[c & 0b111111];
  }
  return out;
}

/** Base64 (with or without newlines, as Gitea sends it) back to UTF-8 text. */
export function base64Decode(encoded: string): string {
  const clean = encoded.replace(/[^A-Za-z0-9+/]/gu, "");
  const bytes: Array<number> = [];
  for (let index = 0; index < clean.length; index += 4) {
    // `indexOf("")` is 0, not -1, so a missing character has to be spotted
    // before the lookup — otherwise a three-character tail decodes a spurious
    // NUL byte and every file this reads ends in one.
    const chunk = [0, 1, 2, 3].map((offset) => {
      const character = clean[index + offset];
      return character === undefined ? -1 : BASE64_ALPHABET.indexOf(character);
    });
    const a = chunk[0] ?? -1;
    const b = chunk[1] ?? -1;
    if (a < 0 || b < 0) break;
    bytes.push((a << 2) | (b >> 4));
    const c = chunk[2] ?? -1;
    if (c < 0) break;
    bytes.push(((b & 0b1111) << 4) | (c >> 2));
    const d = chunk[3] ?? -1;
    if (d < 0) break;
    bytes.push(((c & 0b11) << 6) | d);
  }
  return utf8Text(Uint8Array.from(bytes));
}

function utf8Bytes(text: string): Uint8Array {
  const out: Array<number> = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) out.push(point);
    else if (point < 0x800) out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) {
      out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function utf8Text(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index] ?? 0;
    let point: number;
    let size: number;
    if (byte < 0x80) [point, size] = [byte, 1];
    else if (byte < 0xe0) [point, size] = [byte & 0x1f, 2];
    else if (byte < 0xf0) [point, size] = [byte & 0x0f, 3];
    else [point, size] = [byte & 0x07, 4];
    for (let offset = 1; offset < size; offset += 1) {
      point = (point << 6) | ((bytes[index + offset] ?? 0) & 0x3f);
    }
    out += String.fromCodePoint(point);
    index += size;
  }
  return out;
}
