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

/** Both listings answered by one load. */
const everywhere = (load: Listing): RepositoryLists => ({
  listUserRepositories: load,
  listOrganizationRepositories: load,
});

/** An account listing that names no org, so each org is answered by its own listing. */
const orgOnly = (load: Listing): RepositoryLists => ({
  listUserRepositories: async () => [],
  listOrganizationRepositories: load,
});

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
    reads.repositories("acme", {
      listUserRepositories: async () => {
        calls.push("repos");
        return state.listed;
      },
      listOrganizationRepositories: async () => {
        calls.push("org repos");
        return state.listed;
      },
    });
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
});

/** A Gitea serving each org's listing and the person's, page by page; every request counted. */
function gitea(orgs: Record<string, ReadonlyArray<string>>, own: ReadonlyArray<string> = []) {
  const state = { orgs, own };
  const requests: string[] = [];
  const repository = (owner: string, name: string): GiteaRepository => ({
    ...repo(name),
    full_name: `${owner}/${name}`,
    owner: { login: owner },
  });
  const page = (all: ReadonlyArray<GiteaRepository>, url: URL) => {
    const limit = Number(url.searchParams.get("limit"));
    const at = (Number(url.searchParams.get("page")) - 1) * limit;
    return all.slice(at, at + limit);
  };
  const answer = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = createGiteaClient({
    origin: "https://gitea.example.test",
    token: ["tok", "en"].join(""),
    fetch: (input) => {
      const url = new URL(String(input));
      requests.push(url.pathname.replace("/api/v1", ""));
      const org = /^\/api\/v1\/orgs\/([^/]+)\/repos$/u.exec(url.pathname)?.[1];
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
      const everything = [
        ...Object.entries(state.orgs).flatMap(([owner, names]) =>
          names.map((name) => repository(owner, name)),
        ),
        ...state.own.map((name) => repository("person", name)),
      ];
      return answer(page(everything, url));
    },
  });
  return { client, state, requests, take: () => requests.splice(0) };
}

const orgNames = (count: number) => Array.from({ length: count }, (_, at) => `group${at}`);
const names = (listed: ReadonlyArray<GiteaRepository>) =>
  listed.map((listedRepo) => listedRepo.name);

describe("createForgeReads — one listing for the whole account", () => {
  it.each([
    { orgs: 1, each: 2, requests: ["/user/repos"] },
    { orgs: 14, each: 2, requests: ["/user/repos"] },
    { orgs: 14, each: 4, requests: ["/user/repos", "/user/repos"] },
    { orgs: 25, each: 2, requests: ["/user/repos", "/user/repos"] },
    { orgs: 30, each: 3, requests: ["/user/repos", "/user/repos"] },
  ])(
    "$orgs orgs of $each repositories cost $requests.length requests a refresh",
    async ({ orgs, each, requests }) => {
      const server = gitea(
        Object.fromEntries(
          orgNames(orgs).map((slug) => [slug, Array.from({ length: each }, (_, at) => `r${at}`)]),
        ),
      );
      let clock = NOW;
      const reads = createForgeReads({ now: () => clock });
      // Each group's two readers (the forge and the deploys) list it on the same refresh.
      const refresh = () =>
        Promise.all(
          orgNames(orgs).flatMap((slug) => [
            reads.repositories(slug, server.client),
            reads.repositories(slug, server.client),
          ]),
        );
      for (const listed of await refresh()) expect(listed).toHaveLength(each);
      expect(server.take()).toEqual(requests);
      clock += 60_000;
      await refresh();
      expect(server.take()).toEqual(requests);
    },
  );

  it("feeds each org its own repositories, and none of the person's own", async () => {
    const server = gitea({ acme: ["appdev", "group"], beta: ["group"] }, ["notes"]);
    const reads = createForgeReads({ now: () => NOW });
    expect(names(await reads.repositories("acme", server.client))).toEqual(["appdev", "group"]);
    expect(names(await reads.repositories("beta", server.client))).toEqual(["group"]);
    expect(server.take()).toEqual(["/user/repos"]);
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
    await reads.repositories("acme", server.client);
    await reads.repositories("beta", server.client);
    clock += 60_000;
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
    expect(server.take()).toEqual(["/user/repos", "/user/repos"]);
  });

  it("reads an org the listing does not name on its own, until the listing names it", async () => {
    const server = gitea({ acme: ["group"] });
    let clock = NOW;
    const reads = createForgeReads({ now: () => clock });
    const both = () =>
      Promise.all([
        reads.repositories("acme", server.client),
        reads.repositories("quay", server.client).catch(() => null),
      ]);
    await both();
    expect(server.take()).toEqual(["/user/repos", "/orgs/quay/repos"]);
    expect(reads.organizations().get("quay")).toBe(false);
    clock += 60_000;
    server.state.orgs = { acme: ["group"], quay: ["group"] };
    const [, quay] = await both();
    expect(names(quay ?? [])).toEqual(["group"]);
    expect(server.take()).toEqual(["/user/repos"]);
    expect(reads.organizations().get("quay")).toBe(true);
  });

  it("reads each org on its own when the listing stops at the page limit", async () => {
    const full = Array.from({ length: GITEA_LIST_LIMIT }, (_, at) => repo(`r${at}`));
    const asked: string[] = [];
    const reads = createForgeReads({ now: () => NOW });
    const lists: RepositoryLists = {
      listUserRepositories: async () => {
        asked.push("account");
        return full;
      },
      listOrganizationRepositories: async (owner) => {
        asked.push(owner);
        return [repo("group")];
      },
    };
    expect(names(await reads.repositories("acme", lists))).toEqual(["group"]);
    expect(names(await reads.repositories("beta", lists))).toEqual(["group"]);
    expect(asked).toEqual(["account", "acme", "beta"]);
  });
});
