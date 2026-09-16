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
  /** The probe guide 4.5 insists on: what *this person* may do here. */
  readonly permissions?: GiteaRepositoryPermissions | undefined;
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

export interface GiteaCommitStatus {
  readonly context: string;
  readonly state: "pending" | "success" | "error" | "failure" | "warning";
  readonly description?: string | undefined;
  readonly target_url?: string | undefined;
  readonly created_at?: string | undefined;
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

/** The registration the app makes for itself (`giteaOAuth.ts`). */
export interface GiteaOAuthApplicationRecord {
  readonly id: number;
  readonly name: string;
  readonly client_id: string;
  readonly redirect_uris?: ReadonlyArray<string> | undefined;
  readonly confidential_client?: boolean | undefined;
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

  listOAuthApplications(): Promise<ReadonlyArray<GiteaOAuthApplicationRecord>>;
  createOAuthApplication(body: unknown): Promise<GiteaOAuthApplicationRecord>;

  /** `undefined` while the broker has not made the group's org yet. */
  getOrganization(slug: string): Promise<GiteaOrganization | undefined>;

  getRepository(owner: string, repo: string): Promise<GiteaRepository | undefined>;
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

  createTag(
    owner: string,
    repo: string,
    input: {
      readonly tag: string;
      readonly target: string;
      readonly message?: string | undefined;
    },
  ): Promise<void>;

  listCommitStatuses(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<ReadonlyArray<GiteaCommitStatus>>;

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
    throw new GiteaApiError(`Gitea refused to ${what}.`, response.status, detail);
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

  return {
    origin: options.origin,
    request: (input) => json(input, `answer ${input.method} ${input.path}`),

    currentUser: () => json<GiteaUser>({ method: "GET", path: "/user" }, "say who you are"),

    listOAuthApplications: () =>
      json<ReadonlyArray<GiteaOAuthApplicationRecord>>(
        { method: "GET", path: "/user/applications/oauth2" },
        "list your applications",
      ),
    createOAuthApplication: (body) =>
      json<GiteaOAuthApplicationRecord>(
        { method: "POST", path: "/user/applications/oauth2", body },
        "register the application",
      ),

    getOrganization: (slug) =>
      optional<GiteaOrganization>({ method: "GET", path: `/orgs/${enc(slug)}` }, "read the group"),

    getRepository: (owner, repo) =>
      optional<GiteaRepository>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}` },
        "read the repository",
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
            Do: input?.style ?? "merge",
            ...(input?.title === undefined ? {} : { MergeTitleField: input.title }),
          },
        },
        "merge the pull request",
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

    listCommitStatuses: (owner, repo, sha) =>
      json<ReadonlyArray<GiteaCommitStatus>>(
        { method: "GET", path: `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}/statuses` },
        "list the commit statuses",
      ),

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
