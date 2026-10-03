import { describe, expect, it } from "vite-plus/test";

import {
  createGiteaClient,
  GiteaApiError,
  GITEA_LIST_LIMIT,
  type GiteaCommitStatus,
  type GiteaRepository,
} from "../giteaClient.ts";
import { resolveGroupGitea } from "../groupCreation.ts";
import {
  createForgeReads,
  GATE_FRESH_MS,
  planGateReads,
  TAGS_MAX_AGE_MS,
  type ForgePart,
  type ForgeReads,
  type OrgGate,
  splitAccountListing,
  type RepositoryLists,
} from "./forgeReads.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const LONG_AGO = "2026-10-01T08:00:00Z";
const JUST_NOW = "2026-10-02T11:59:58Z";

const repo = (
  name: string,
  fields: Partial<Pick<GiteaRepository, "updated_at" | "open_pr_counter" | "default_branch">> = {},
): GiteaRepository => ({
  id: name.length,
  name,
  full_name: `acme/${name}`,
  default_branch: "main",
  updated_at: LONG_AGO,
  open_pr_counter: 0,
  ...fields,
});

const gateOf = (listed: ReadonlyArray<GiteaRepository>, nowMs = NOW): OrgGate =>
  planGateReads(undefined, listed, nowMs).gate;

/** Each repository's parts read again, sorted, for comparing. */
const rereads = (plan: ReturnType<typeof planGateReads>) =>
  Object.fromEntries([...plan.reread].map(([name, parts]) => [name, [...parts].toSorted()]));

const EVERYTHING: ReadonlyArray<ForgePart> = ["code", "pulls", "statuses"];

type Listing = () => Promise<ReadonlyArray<GiteaRepository>>;

/** Both listings answered by one load: the account's and the org's own. */
const everywhere = (load: Listing): RepositoryLists => ({
  currentUser: async () => ({ id: 9, login: "u-person" }),
  listAccountRepositories: async () => {
    const repositories = await load();
    return { repositories, counts: [repositories.length] };
  },
  listOrganizationRepositories: load,
});

/** The org's own listing alone. */
const orgOnly = (load: Listing): RepositoryLists => ({ listOrganizationRepositories: load });

describe("planGateReads", () => {
  const before = [repo("appdev"), repo("group", { open_pr_counter: 1 })];

  it.each([
    {
      name: "the first listing reads everything",
      previous: undefined,
      listed: before,
      reread: { appdev: EVERYTHING, group: EVERYTHING },
    },
    {
      name: "an unchanged listing reads nothing",
      previous: gateOf(before),
      listed: before,
      reread: {},
    },
    {
      name: "a moved open counter reads that repository's pull requests only",
      previous: gateOf(before),
      listed: [repo("appdev", { open_pr_counter: 1 }), before[1]!],
      reread: { appdev: ["pulls"] },
    },
    {
      name: "a push reads that repository's pull requests, code and statuses",
      previous: gateOf(before),
      listed: [repo("appdev", { updated_at: "2026-10-02T10:00:00Z" }), before[1]!],
      reread: { appdev: EVERYTHING },
    },
    {
      name: "a new default branch reads the repository again",
      previous: gateOf(before),
      listed: [repo("appdev", { default_branch: "trunk" }), before[1]!],
      reread: { appdev: EVERYTHING },
    },
    {
      name: "a new repository is read, and one gone is dropped",
      previous: gateOf(before),
      listed: [repo("apidev"), before[1]!],
      reread: { apidev: EVERYTHING, appdev: EVERYTHING },
    },
    {
      name: "a repository listed without its fields is read every time",
      previous: gateOf([repo("appdev", { updated_at: undefined })]),
      listed: [repo("appdev", { updated_at: undefined })],
      reread: { appdev: EVERYTHING },
    },
    {
      name: "a push too recent to trust reads its pull requests and code once more",
      previous: gateOf([repo("appdev", { updated_at: JUST_NOW })]),
      listed: [repo("appdev", { updated_at: JUST_NOW })],
      reread: { appdev: ["code", "pulls"] },
    },
  ])("$name", ({ previous, listed, reread }) => {
    expect(rereads(planGateReads(previous, listed, NOW))).toEqual(reread);
  });

  it("trusts a recent push once it was read again", () => {
    const listed = [repo("appdev", { updated_at: JUST_NOW })];
    const second = planGateReads(gateOf(listed), listed, NOW + 60_000);
    expect(rereads(planGateReads(second.gate, listed, NOW + 120_000))).toEqual({});
  });
});

/** An org whose listing, files, pull requests and statuses answer from `state`; every ask counted. */
function org(listed: Array<GiteaRepository>) {
  const state = { listed };
  const calls: string[] = [];
  let clock = NOW;
  const reads = createForgeReads({ now: () => clock });
  const list = () =>
    reads.repositories(
      "acme",
      orgOnly(async () => {
        calls.push("repos");
        return state.listed;
      }),
    );
  const pulls = (name: string) =>
    reads.read({ owner: "acme", repo: name, part: "pulls", key: "pulls?state=open" }, async () => {
      calls.push(`pulls ${name}`);
      return [];
    });
  const file = (name: string) =>
    reads.read({ owner: "acme", repo: name, part: "code", key: "contents/a.yaml" }, async () => {
      calls.push(`file ${name}`);
      return "a: 1";
    });
  const statuses = (name: string, answer: GiteaCommitStatus["state"] = "success") =>
    reads.statuses.read({ owner: "acme", repo: name, sha: "c".repeat(40) }, async () => {
      calls.push(`statuses ${name}`);
      return [{ context: "ci", state: answer }];
    });
  /** One reader's whole pass: the listing, then each repository's pulls, a file and statuses. */
  const pass = async () => {
    for (const repository of await list()) {
      await pulls(repository.name);
      await file(repository.name);
      await statuses(repository.name);
    }
  };
  return {
    reads: reads as ForgeReads,
    state,
    calls,
    pass,
    pulls,
    list,
    advance: (ms: number) => {
      clock += ms;
    },
    take: () => calls.splice(0),
  };
}

describe("createForgeReads", () => {
  it("asks only for the listing on a refresh where nothing moved", async () => {
    const forge = org([repo("appdev"), repo("group")]);
    await forge.pass();
    forge.take();
    forge.advance(60_000);
    await forge.pass();
    expect(forge.take()).toEqual(["repos"]);
  });

  it("asks for one repository's pull requests where its open counter moved", async () => {
    const forge = org([repo("appdev"), repo("group")]);
    await forge.pass();
    forge.take();
    forge.advance(60_000);
    forge.state.listed = [repo("appdev", { open_pr_counter: 2 }), repo("group")];
    await forge.pass();
    expect(forge.take()).toEqual(["repos", "pulls appdev"]);
  });

  it("asks for a pushed repository's pull requests, code and statuses, and nothing else", async () => {
    const forge = org([repo("appdev"), repo("group")]);
    await forge.pass();
    forge.take();
    forge.advance(60_000);
    forge.state.listed = [repo("appdev"), repo("group", { updated_at: "2026-10-02T11:00:00Z" })];
    await forge.pass();
    expect(forge.take()).toEqual(["repos", "pulls group", "file group", "statuses group"]);
  });

  it("never asks again for settled statuses while the listing stands", async () => {
    const forge = org([repo("appdev")]);
    for (let minute = 0; minute < 30; minute += 1) {
      await forge.pass();
      forge.advance(60_000);
    }
    expect(forge.take().filter((call) => call.startsWith("statuses"))).toEqual(["statuses appdev"]);
  });

  it("shares one listing between the readers of one refresh", async () => {
    const forge = org([repo("appdev")]);
    await Promise.all([forge.pass(), forge.pass()]);
    forge.advance(GATE_FRESH_MS - 1);
    await forge.pass();
    expect(forge.take().filter((call) => call === "repos")).toEqual(["repos"]);
  });

  it("keeps nothing for a repository the listing does not vouch for", async () => {
    const forge = org([repo("appdev", { open_pr_counter: undefined }), repo("group")]);
    await forge.list();
    await forge.pulls("appdev");
    await forge.pulls("appdev");
    await forge.pulls("other");
    await forge.pulls("group");
    await forge.pulls("group");
    expect(forge.take()).toEqual([
      "repos",
      "pulls appdev",
      "pulls appdev",
      "pulls other",
      "pulls group",
    ]);
  });

  it("reads a part again once it is older than its caller allows, saying whether it changed", async () => {
    const forge = org([repo("group")]);
    await forge.list();
    let tags = ["v0.1.0"];
    const read = () =>
      forge.reads.read(
        { owner: "acme", repo: "group", part: "code", key: "tags" },
        async () => {
          forge.calls.push("tags");
          return tags;
        },
        { maxAgeMs: TAGS_MAX_AGE_MS },
      );
    expect((await read()).changed).toBe(true);
    forge.advance(TAGS_MAX_AGE_MS - 1);
    expect(await read()).toMatchObject({ changed: false, atMs: NOW });
    forge.advance(1);
    expect((await read()).changed).toBe(false);
    tags = ["v0.1.1", "v0.1.0"];
    forge.advance(TAGS_MAX_AGE_MS);
    expect((await read()).changed).toBe(true);
    expect(forge.take()).toEqual(["repos", "tags", "tags", "tags"]);
  });

  it("forgets what a verb changed, and keeps no answer from a read started before it", async () => {
    const forge = org([repo("appdev")]);
    await forge.list();
    let answer: (value: ReadonlyArray<number>) => void = () => undefined;
    const ref = { owner: "acme", repo: "appdev", part: "pulls", key: "open" } as const;
    const early = forge.reads.read(ref, () => new Promise((resolve) => (answer = resolve)));
    forge.reads.forget("acme", "appdev", new Set(["pulls"]));
    const fresh = await forge.reads.read(ref, async () => [2]);
    answer([1]);
    expect((await early).value).toEqual([1]);
    expect(fresh.value).toEqual([2]);
    expect((await forge.reads.read(ref, async () => [3])).value).toEqual([2]);
  });

  it.each([
    { name: "a 401", status: 401, counted: 1 },
    { name: "a 500", status: 500, counted: 0 },
  ])(
    "counts $name a shared read met as Gitea refusing the token: $counted",
    async ({ status, counted }) => {
      const forge = org([repo("appdev")]);
      const refused = () => Promise.reject(new GiteaApiError("Gitea said no.", status));
      await expect(forge.reads.repositories("other", everywhere(refused))).rejects.toThrow();
      await forge.list();
      const ref = { owner: "acme", repo: "appdev", part: "pulls", key: "open" } as const;
      await expect(forge.reads.read(ref, refused)).rejects.toThrow();
      const commit = { owner: "acme", repo: "appdev", sha: "d".repeat(40) };
      await expect(forge.reads.statuses.read(commit, refused)).rejects.toThrow();
      expect(forge.reads.unauthorized()).toBe(3 * counted);
    },
  );

  it("keeps no listing that failed, and asks again on the next refresh", async () => {
    const forge = org([repo("appdev")]);
    await expect(
      forge.reads.repositories(
        "acme",
        everywhere(() => Promise.reject(new Error("offline"))),
      ),
    ).rejects.toThrow("offline");
    await forge.list();
    expect(forge.take()).toEqual(["repos"]);
  });
});

describe("createForgeReads — whether a group's Gitea org is made", () => {
  const missing = () => Promise.reject(new GiteaApiError("Not found", 404));
  const listed = () => Promise.resolve([repo("group")]);
  const refused = (status: number) => () => Promise.reject(new GiteaApiError("No", status));

  it.each([
    {
      name: "a 404 is not made yet, and the 200 after it is made: the line goes",
      answers: [missing, listed],
      made: [false, true],
      line: ["being-set-up", "ready"],
      told: 2,
    },
    {
      name: "a failure that is not a 404 says nothing",
      answers: [refused(500), refused(401)],
      made: [undefined, undefined],
      line: ["unknown", "unknown"],
      told: 0,
    },
    {
      name: "a failure after an answer keeps the answer",
      answers: [listed, refused(502)],
      made: [true, true],
      line: ["ready", "ready"],
      told: 1,
    },
    {
      // Pass 32 review: a 404 on an org listed before is a failure, read after read — never
      // "not made yet", which would wipe what its group held.
      name: "an org listed before stays made through its 404s",
      answers: [listed, missing, missing],
      made: [true, true, true],
      line: ["ready", "ready", "ready"],
      told: 1,
    },
  ])("$name", async ({ answers, made, line, told: expectedTold }) => {
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    let told = 0;
    reads.subscribe(() => {
      told += 1;
    });
    const seen: Array<boolean | undefined> = [];
    for (const answer of answers) {
      await reads.repositories("quay", orgOnly(answer)).catch(() => []);
      seen.push(reads.organizations().get("quay"));
      clock += GATE_FRESH_MS;
    }
    expect(seen).toEqual(made);
    expect(seen.map((organizationExists) => resolveGroupGitea({ organizationExists }))).toEqual(
      line,
    );
    // Told once per change of what it says, never for an answer that moved nothing.
    expect(told).toBe(expectedTold);
  });

  it("shares a 404 between the readers of one refresh, and asks again on the next", async () => {
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    let asked = 0;
    const ask = () =>
      reads.repositories(
        "quay",
        orgOnly(() => {
          asked += 1;
          return missing();
        }),
      );
    await expect(ask()).rejects.toThrow("Not found");
    await expect(ask()).rejects.toThrow("Not found");
    expect(asked).toBe(1);
    clock += GATE_FRESH_MS;
    await expect(ask()).rejects.toThrow("Not found");
    expect(asked).toBe(2);
  });

  // The reviewer's repro (pass 37): a group created between two ticks is read at once, its org
  // still being made; the broker makes it before the next tick, which must see it.
  it.each([
    { name: "a 404 off the tick answers no later tick", madeAtMs: 55_000, made: true },
    { name: "a 404 stays shared until the next tick", madeAtMs: undefined, made: false },
  ])("$name", async ({ madeAtMs, made }) => {
    const server = gitea({ acme: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    reads.tick();
    await reads.repositories("acme", server.client);
    clock = NOW + 40_000;
    await expect(reads.repositories("fresh", server.client)).rejects.toThrow();
    if (madeAtMs !== undefined) {
      clock = NOW + madeAtMs;
      server.state.orgs = { acme: ["group"], fresh: ["group"] };
    }
    clock = NOW + 60_000;
    reads.tick();
    await reads.repositories("acme", server.client);
    await reads.repositories("fresh", server.client).catch(() => null);
    expect(reads.organizations().get("fresh")).toBe(made);
  });
});

/**
 * A Gitea serving each org's listing and the person's, page by page; every request counted. As
 * Gitea 1.27.2 does, `/user/repos` orders by name — and equal names come back in another order on
 * every request, as a database may answer them — while `/repos/search?sort=id` orders by id, unless
 * `sortsById` is off.
 */
function gitea(
  orgs: Record<string, ReadonlyArray<string>>,
  own: ReadonlyArray<string> = [],
  options: { readonly sortsById?: boolean } = {},
) {
  const state = {
    orgs,
    own,
    /** Open pull requests by `owner/name`. */
    pulls: {} as Record<string, number>,
    /** What the account listings answer instead, while set. */
    refusing: undefined as number | "offline" | undefined,
  };
  const requests: string[] = [];
  const ids = new Map<string, number>();
  const idOf = (fullName: string) => {
    const held = ids.get(fullName);
    if (held !== undefined) return held;
    ids.set(fullName, ids.size + 1);
    return ids.size;
  };
  const repository = (owner: string, name: string): GiteaRepository => ({
    ...repo(name, { open_pr_counter: state.pulls[`${owner}/${name}`] ?? 0 }),
    id: idOf(`${owner}/${name}`),
    full_name: `${owner}/${name}`,
    owner: { login: owner },
  });
  const everything = () => [
    ...Object.entries(state.orgs).flatMap(([owner, names]) =>
      names.map((name) => repository(owner, name)),
    ),
    ...state.own.map((name) => repository("person", name)),
  ];
  let asked = 0;
  const byName = () => {
    asked += 1;
    const flip = asked % 2 === 0 ? -1 : 1;
    return everything().toSorted((a, b) => a.name.localeCompare(b.name) || flip * (a.id - b.id));
  };
  const page = (all: ReadonlyArray<GiteaRepository>, url: URL) => {
    const limit = Number(url.searchParams.get("limit"));
    const at = (Number(url.searchParams.get("page")) - 1) * limit;
    return all.slice(at, at + limit);
  };
  const answer = (body: unknown, status = 200, count?: number) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          ...(count === undefined ? {} : { "x-total-count": String(count) }),
        },
      }),
    );
  const client = createGiteaClient({
    origin: "https://gitea.example.test",
    token: ["tok", "en"].join(""),
    fetch: (input) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      requests.push(path);
      const org = /^\/orgs\/([^/]+)\/repos$/u.exec(path)?.[1];
      if (org !== undefined) {
        const names = state.orgs[org];
        if (names === undefined) return answer({ message: "not found" }, 404);
        return answer(
          page(
            names.map((name) => repository(org, name)),
            url,
          ),
        );
      }
      if (path === "/user") return answer({ id: 9, login: "u-person" });
      if (state.refusing === "offline") return Promise.reject(new TypeError("Failed to fetch"));
      if (state.refusing !== undefined) return answer({ message: "no" }, state.refusing);
      const total = everything().length;
      if (path === "/user/repos") return answer(page(byName(), url), 200, total);
      const all =
        options.sortsById === false ? byName() : everything().toSorted((a, b) => a.id - b.id);
      return answer({ ok: true, data: page(all, url) }, 200, total);
    },
  });
  return { client, state, requests, take: () => requests.splice(0) };
}

const orgNames = (count: number) => Array.from({ length: count }, (_, at) => `group${at}`);
const names = (listed: ReadonlyArray<GiteaRepository>) =>
  listed.map((listedRepo) => listedRepo.name);

describe("createForgeReads — one listing for the whole account", () => {
  it.each([
    { orgs: 1, each: 2, pages: 1 },
    { orgs: 14, each: 2, pages: 1 },
    { orgs: 14, each: 4, pages: 2 },
    // Exactly a page: the count says it is all, and no empty page is asked for.
    { orgs: 25, each: 2, pages: 1 },
    { orgs: 30, each: 3, pages: 2 },
  ])(
    "$orgs orgs of $each repositories cost $pages listing pages a refresh",
    async ({ orgs, each, pages }) => {
      const server = gitea(
        Object.fromEntries(
          orgNames(orgs).map((slug) => [slug, Array.from({ length: each }, (_, at) => `r${at}`)]),
        ),
      );
      let clock = NOW;
      const reads = createForgeReads({ now: () => clock });
      // Each group's two readers (the forge and the deploys) list it on the same refresh.
      const refresh = () => {
        reads.tick();
        return Promise.all(
          orgNames(orgs).flatMap((slug) => [
            reads.repositories(slug, server.client),
            reads.repositories(slug, server.client),
          ]),
        );
      };
      const listing = Array.from({ length: pages }, () => "/repos/search");
      for (const listed of await refresh()) expect(listed).toHaveLength(each);
      // Who the person is, once: the listing asks by their id.
      expect(server.take()).toEqual(["/user", ...listing]);
      clock += 60_000;
      await refresh();
      expect(server.take()).toEqual(listing);
    },
  );

  it("feeds each org its own repositories, and none of the person's own", async () => {
    const server = gitea({ acme: ["appdev", "group"], beta: ["group"] }, ["notes"]);
    const reads = createForgeReads({ now: () => NOW });
    expect(names(await reads.repositories("acme", server.client))).toEqual(["appdev", "group"]);
    expect(names(await reads.repositories("beta", server.client))).toEqual(["group"]);
    expect(server.take()).toEqual(["/user", "/repos/search"]);
    expect(reads.organizations()).toEqual(
      new Map([
        ["acme", true],
        ["beta", true],
      ]),
    );
  });

  it("drops what a repository added, removed or moved to another org had", async () => {
    const server = gitea({ acme: ["appdev", "apidev"], beta: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    reads.tick();
    await reads.repositories("acme", server.client);
    await reads.repositories("beta", server.client);
    clock += 60_000;
    reads.tick();
    // apidev moved to beta, webdev is new in acme.
    server.state.orgs = { acme: ["appdev", "webdev"], beta: ["group", "apidev"] };
    const moved: Record<string, ReadonlyArray<string>> = {};
    const listed: Record<string, ReadonlyArray<string>> = {};
    for (const owner of ["acme", "beta"]) {
      listed[owner] = names(
        await reads.repositories(owner, server.client, {
          moved: (reread) => {
            moved[owner] = [...reread.keys()].toSorted();
          },
        }),
      );
    }
    expect(listed).toEqual({ acme: ["appdev", "webdev"], beta: ["group", "apidev"] });
    expect(moved).toEqual({ acme: ["apidev", "webdev"], beta: ["apidev"] });
    expect(server.take()).toEqual(["/user", "/repos/search", "/repos/search"]);
  });

  it("reads an org the listing does not name on its own, until the listing names it", async () => {
    const server = gitea({ acme: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    const both = () => {
      reads.tick();
      return Promise.all([
        reads.repositories("acme", server.client),
        reads.repositories("quay", server.client).catch(() => null),
      ]);
    };
    await both();
    expect(server.take()).toEqual(["/user", "/repos/search", "/orgs/quay/repos"]);
    expect(reads.organizations().get("quay")).toBe(false);
    clock += 60_000;
    server.state.orgs = { acme: ["group"], quay: ["group"] };
    const [, quay] = await both();
    expect(names(quay ?? [])).toEqual(["group"]);
    expect(server.take()).toEqual(["/repos/search"]);
    expect(reads.organizations().get("quay")).toBe(true);
  });

  // Every group has a repository named `group`: a listing by name pages through 30 equal names.
  it.each([
    { name: "Gitea orders the listing by id", sortsById: true },
    { name: "pages of equal names drop and repeat rows", sortsById: false },
  ])("drops and doubles no repository when $name", async ({ sortsById }) => {
    const slugs = orgNames(30);
    const server = gitea(Object.fromEntries(slugs.map((slug) => [slug, ["app", "group"]])), [], {
      sortsById,
    });
    const reads = createForgeReads({ now: () => NOW });
    reads.tick();
    for (const slug of slugs) {
      expect(names(await reads.repositories(slug, server.client)).toSorted()).toEqual([
        "app",
        "group",
      ]);
    }
    const asked = server.take();
    expect(asked.filter((path) => path === "/repos/search")).toHaveLength(2);
    expect(asked.filter((path) => path.startsWith("/orgs/")).length).toBe(
      sortsById ? 0 : slugs.length,
    );
  });

  it.each([
    { name: "a 500", refusing: 500 },
    { name: "a lost connection", refusing: "offline" as const },
  ])("reads each org on its own when the account listing meets $name", async ({ refusing }) => {
    const server = gitea({ acme: ["appdev", "group"], beta: ["group"] });
    const reads = createForgeReads({ now: () => NOW });
    server.state.refusing = refusing;
    reads.tick();
    const [acme, beta, quay] = await Promise.all([
      reads.repositories("acme", server.client),
      reads.repositories("beta", server.client),
      reads.repositories("quay", server.client).catch((cause: unknown) => cause),
    ]);
    expect(names(acme)).toEqual(["appdev", "group"]);
    expect(names(beta)).toEqual(["group"]);
    // A group the broker is still making is being set up, not failing.
    expect(quay).toBeInstanceOf(GiteaApiError);
    expect(reads.organizations().get("quay")).toBe(false);
    expect(server.take().toSorted()).toEqual([
      "/orgs/acme/repos",
      "/orgs/beta/repos",
      "/orgs/quay/repos",
      "/repos/search",
      "/user",
    ]);
  });

  it("answers every org with the session's 401 when the account listing meets one", async () => {
    const server = gitea({ acme: ["group"], beta: ["group"] });
    const reads = createForgeReads({ now: () => NOW });
    server.state.refusing = 401;
    const answers = await Promise.allSettled([
      reads.repositories("acme", server.client),
      reads.repositories("beta", server.client),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual(["rejected", "rejected"]);
    expect(server.take()).toEqual(["/user", "/repos/search"]);
  });

  it.each([
    { name: "another org's read off its tick", watched: false },
    { name: "the pull watch's look at another org", watched: true },
  ])("shows an org's new pull request on its next tick after $name", async ({ watched }) => {
    const server = gitea({ acme: ["group"], beta: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    const tick = () => {
      reads.tick();
      return Promise.all([
        reads.repositories("acme", server.client),
        reads.repositories("beta", server.client),
      ]);
    };
    await tick();
    clock += 45_000;
    await (watched
      ? reads.repositories(
          "acme",
          { listOrganizationRepositories: server.client.listOrganizationRepositories },
          { maxAgeMs: 13_000 },
        )
      : reads.repositories("acme", server.client));
    clock += 5_000;
    server.state.pulls = { "beta/group": 1 };
    clock += 10_000;
    const [, beta] = await tick();
    expect(beta[0]?.open_pr_counter).toBe(1);
  });

  it("shares one listing between the two readers' ticks a moment apart", async () => {
    const server = gitea({ acme: ["group"], beta: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    reads.tick();
    await reads.repositories("acme", server.client);
    clock += 1_000;
    reads.tick();
    await reads.repositories("beta", server.client);
    expect(server.take()).toEqual(["/user", "/repos/search"]);
  });

  it.each([
    {
      name: "stops at the page limit",
      listed: () => Array.from({ length: GITEA_LIST_LIMIT }, (_, at) => repo(`r${at}`)),
    },
    {
      name: "names none of the orgs asked of it",
      listed: () => [{ ...repo("notes"), full_name: "person/notes", owner: { login: "person" } }],
    },
  ])("reads each org on its own for ten minutes after a listing that $name", async ({ listed }) => {
    const asked: string[] = [];
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    const lists: RepositoryLists = {
      currentUser: async () => ({ id: 9, login: "u-person" }),
      listAccountRepositories: async () => {
        asked.push("account");
        const repositories = listed();
        return { repositories, counts: [repositories.length] };
      },
      listOrganizationRepositories: async (owner) => {
        asked.push(owner);
        return [repo("group")];
      },
    };
    const refresh = async () => {
      reads.tick();
      expect(names(await reads.repositories("acme", lists))).toEqual(["group"]);
      expect(names(await reads.repositories("beta", lists))).toEqual(["group"]);
      clock += 60_000;
      return asked.splice(0);
    };
    expect(await refresh()).toEqual(["account", "acme", "beta"]);
    const skipped: Array<ReadonlyArray<string>> = [];
    for (let minute = 1; minute < 10; minute += 1) skipped.push(await refresh());
    expect(new Set(skipped.map((each) => each.join(" ")))).toEqual(new Set(["acme beta"]));
    expect(await refresh()).toEqual(["account", "acme", "beta"]);
  });
});

describe("splitAccountListing", () => {
  const at = (owner: string, name: string, id: number): GiteaRepository => ({
    ...repo(name),
    id,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
  });
  const acme = at("acme", "group", 1);
  const beta = at("Beta", "group", 2);

  it.each([
    {
      name: "cuts each owner's part",
      repositories: [acme, beta],
      counts: [2],
      split: { acme: ["group"], beta: ["group"] },
    },
    { name: "says nothing of a repeated row", repositories: [acme, acme], counts: [2] },
    { name: "says nothing short of the count", repositories: [acme], counts: [2] },
    { name: "says nothing when the pages disagree", repositories: [acme, beta], counts: [3, 2] },
    {
      name: "trusts pages that sent no count",
      repositories: [acme, beta],
      counts: [undefined],
      split: { acme: ["group"], beta: ["group"] },
    },
  ])("$name", ({ repositories, counts, split }) => {
    const answer = splitAccountListing({ repositories, counts });
    expect(
      answer.kind === "split"
        ? Object.fromEntries([...answer.byOwner].map(([owner, part]) => [owner, names(part)]))
        : answer.kind,
    ).toEqual(split ?? "unsure");
  });

  it("is capped at the client's page limit", () => {
    const full = Array.from({ length: GITEA_LIST_LIMIT }, (_, id) => at("acme", `r${id}`, id));
    expect(splitAccountListing({ repositories: full, counts: [] }).kind).toBe("capped");
  });
});
