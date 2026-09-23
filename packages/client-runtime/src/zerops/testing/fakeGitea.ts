/**
 * Gitea and the org's Gitea broker as the account harness serves them (DESIGN §11.1): each
 * behind a `fetch` the real `giteaClient.ts` and `authorization/giteaBroker.ts` call.
 *
 * The broker is scripted: it mints person tokens, answers 502 while Gitea is still setting up,
 * 403 to a person who is not a member, 424 in Gitea's words, or nothing at all while it is
 * unreachable. Gitea answers 401 to a token revoked mid-read, and plays a pull request's
 * `mergeable` sequence. Every request is logged with the bearer it carried.
 */

const GITEA_API_PREFIX = "/api/v1";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function bearerOf(init: RequestInit | undefined): string | null {
  const headers = new Headers(init?.headers);
  const authorization = headers.get("authorization");
  return authorization === null ? null : authorization.replace(/^Bearer\s+/iu, "");
}

function urlOf(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

/** A fake that answers one origin. */
export interface FakeOrigin {
  readonly origin: string;
  readonly fetch: typeof globalThis.fetch;
}

/** One `fetch` over several fakes; a request to any other origin fails at the network. */
export function fetchAcross(...fakes: ReadonlyArray<FakeOrigin>): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const origin = urlOf(input).origin;
    const fake = fakes.find((candidate) => new URL(candidate.origin).origin === origin);
    if (fake === undefined) throw new TypeError("Failed to fetch");
    return fake.fetch(input, init);
  }) as typeof globalThis.fetch;
}

export interface FakeGiteaRequest {
  /** `METHOD /path`, without the API prefix or the query. */
  readonly route: string;
  readonly bearer: string | null;
}

export interface FakeGitea extends FakeOrigin {
  /** A token that acts as `login` until it is revoked. */
  readonly issue: (login: string) => string;
  /** Every later request carrying it answers 401. */
  readonly revoke: (token: string) => void;
  readonly setTags: (owner: string, repo: string, tags: ReadonlyArray<string>) => void;
  /** Each read of the pull request answers the next value; the last one holds. */
  readonly scriptMergeable: (
    owner: string,
    repo: string,
    number: number,
    sequence: ReadonlyArray<boolean | null>,
  ) => void;
  readonly requests: () => ReadonlyArray<FakeGiteaRequest>;
}

export function makeFakeGitea(origin: string): FakeGitea {
  const tokens = new Map<string, string>();
  const revoked = new Set<string>();
  const tags = new Map<string, ReadonlyArray<string>>();
  const mergeable = new Map<string, Array<boolean | null>>();
  const log: FakeGiteaRequest[] = [];
  let issued = 0;

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    const path = url.pathname.startsWith(GITEA_API_PREFIX)
      ? url.pathname.slice(GITEA_API_PREFIX.length)
      : url.pathname;
    const bearer = bearerOf(init);
    const route = `${init?.method ?? "GET"} ${path}`;
    log.push({ route, bearer });
    if (bearer === null || !tokens.has(bearer) || revoked.has(bearer)) {
      return json(401, { message: "token does not exist" });
    }
    const tagsRoute = /^GET \/repos\/([^/]+)\/([^/]+)\/tags$/u.exec(route);
    if (tagsRoute !== null) {
      const names = tags.get(`${tagsRoute[1]}/${tagsRoute[2]}`) ?? [];
      return json(
        200,
        names.map((name) => ({ name })),
      );
    }
    const pullRoute = /^GET \/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/u.exec(route);
    if (pullRoute !== null) {
      const sequence = mergeable.get(`${pullRoute[1]}/${pullRoute[2]}#${pullRoute[3]}`);
      if (sequence === undefined) return json(404, { message: "pull request does not exist" });
      const value = sequence.length > 1 ? sequence.shift() : sequence[0];
      return json(200, {
        number: Number(pullRoute[3]),
        title: "change",
        state: "open",
        mergeable: value,
      });
    }
    return json(404, { message: "not found" });
  }) as typeof globalThis.fetch;

  return {
    origin,
    fetch,
    issue: (login) => {
      issued += 1;
      const token = `gitea-token-${String(issued)}`;
      tokens.set(token, login);
      return token;
    },
    revoke: (token) => {
      revoked.add(token);
    },
    setTags: (owner, repo, names) => {
      tags.set(`${owner}/${repo}`, [...names]);
    },
    scriptMergeable: (owner, repo, number, sequence) => {
      mergeable.set(`${owner}/${repo}#${String(number)}`, [...sequence]);
    },
    requests: () => [...log],
  };
}

export type FakeBrokerMode =
  /** Mints the person a Gitea token. */
  | "answering"
  /** 502: the broker cannot reach a Gitea that is still setting up. */
  | "setting-up"
  /** Every request, credential-less ones included, fails at the network. */
  | "unreachable"
  /** 403: the person is not an active member of the organization. */
  | "not-a-member"
  /** 424: Gitea refused, in its own words. */
  | "gitea-refused";

export interface FakeBrokerRequest {
  readonly route: string;
  readonly bearer: string | null;
  /** The request's `mode`, `null` when the caller set none. */
  readonly mode: RequestMode | null;
}

export interface FakeBroker extends FakeOrigin {
  readonly answer: (mode: FakeBrokerMode) => void;
  /** The `expiresIn` (seconds) person tokens carry from now on; `undefined` sends none. */
  readonly expiresIn: (seconds: number | undefined) => void;
  /** Person tokens minted so far. */
  readonly personTokens: () => number;
  /** Every request that reached the broker, in arrival order. */
  readonly requests: () => ReadonlyArray<FakeBrokerRequest>;
}

export function makeFakeBroker(input: {
  readonly origin: string;
  readonly gitea: FakeGitea;
  /** The Gitea login a throwaway names; one person by default. */
  readonly loginOf?: (throwaway: string) => string;
}): FakeBroker {
  const loginOf = input.loginOf ?? (() => "u-person");
  let mode: FakeBrokerMode = "answering";
  let expiresInSeconds: number | undefined;
  let minted = 0;
  const log: FakeBrokerRequest[] = [];

  const fetch = (async (request: string | URL | Request, init?: RequestInit) => {
    if (mode === "unreachable") throw new TypeError("Failed to fetch");
    const url = urlOf(request);
    const bearer = bearerOf(init);
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    log.push({ route, bearer, mode: init?.mode ?? null });
    if (route !== "POST /person/token") return json(404, { error: "not_found" });
    if (bearer === null) return json(401, { error: "unauthorized", message: "no throwaway" });
    switch (mode) {
      case "setting-up":
        return json(502, { error: "gitea", message: "Gitea could not be reached" });
      case "not-a-member":
        return json(403, {
          error: "not_a_member",
          message: "that account is not an active member",
        });
      case "gitea-refused":
        return json(424, {
          error: "gitea_refused",
          message: "Gitea refused: login source does not exist [id: 1]",
        });
      case "answering": {
        minted += 1;
        const login = loginOf(bearer);
        return json(200, {
          token: input.gitea.issue(login),
          login,
          ...(expiresInSeconds === undefined ? {} : { expiresIn: expiresInSeconds }),
        });
      }
    }
  }) as typeof globalThis.fetch;

  return {
    origin: input.origin,
    fetch,
    answer: (next) => {
      mode = next;
    },
    expiresIn: (seconds) => {
      expiresInSeconds = seconds;
    },
    personTokens: () => minted,
    requests: () => [...log],
  };
}
