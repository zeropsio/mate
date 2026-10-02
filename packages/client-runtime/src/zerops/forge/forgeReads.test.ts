import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommitStatus, GiteaRepository } from "../giteaClient.ts";
import {
  createForgeReads,
  GATE_FRESH_MS,
  planGateReads,
  TAGS_MAX_AGE_MS,
  type ForgePart,
  type ForgeReads,
  type OrgGate,
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
    reads.repositories("acme", async () => {
      calls.push("repos");
      return state.listed;
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

  it("keeps no listing that failed, and asks again on the next refresh", async () => {
    const forge = org([repo("appdev")]);
    await expect(
      forge.reads.repositories("acme", () => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    await forge.list();
    expect(forge.take()).toEqual(["repos"]);
  });
});
