import { describe, expect, it } from "@effect/vitest";
import type { Change, Principal, RefUpdate, Repo } from "./api.ts";
import { allowRefUpdate } from "./rules.ts";

const mate: Principal = { kind: "mate", mateId: "alice", appId: "app" };
const repo = { appId: "app", id: "repo" };
const update: RefUpdate = {
  oldSha: "0".repeat(40),
  newSha: "1".repeat(40),
  ref: "refs/heads/mate/alice/1",
};
const change: Change = { appId: "app", mateId: "alice", number: 1, open: true };
/** The decision on `patch`, the branch bound to `record` (the change Core answers for it). */
const decide = (
  principal: Principal = mate,
  patch: Partial<RefUpdate> = {},
  record: Change | null = change,
) => allowRefUpdate(principal, repo, { ...update, ...patch }, async () => record);

describe("default write rules", () => {
  it("allows an application's person to push a topic branch without a Mate change", async () => {
    const person: Principal = { kind: "person", userId: "user", appId: "app" };
    expect(await decide(person, { ref: "refs/heads/feature/source" }, null)).toEqual({
      allowed: true,
    });
  });

  it.each([
    "refs/heads/main",
    "refs/heads/mate",
    "refs/heads/mate/alice/1",
    "refs/tags/v1",
    "refs/notes/review",
  ])("protects %s from a person even with write permission", async (ref) => {
    expect(await decide({ kind: "person", userId: "user", appId: "app" }, { ref })).toEqual({
      allowed: false,
      reason: "protected_ref",
    });
  });

  it("refuses a person's other application and branch deletion", async () => {
    expect(
      await decide({ kind: "person", userId: "user", appId: "other" }, { ref: "refs/heads/topic" }),
    ).toEqual({ allowed: false, reason: "not_your_ref" });
    expect(
      await decide(
        { kind: "person", userId: "user", appId: "app" },
        { ref: "refs/heads/topic", newSha: "0".repeat(40) },
      ),
    ).toEqual({ allowed: false, reason: "deletion" });
  });

  it("allows an allocated open change and core's main/tags", async () => {
    expect(await decide()).toEqual({ allowed: true });
    for (const ref of ["refs/heads/main", "refs/tags/v1"]) {
      expect(await decide({ kind: "core" }, { ref })).toEqual({ allowed: true });
    }
  });

  it("asks the async change port with the repository and the pushed branch", async () => {
    const asked: Array<[Repo, string]> = [];
    const decision = await allowRefUpdate(
      mate,
      repo,
      { ...update, ref: "refs/heads/fix/login" },
      async (target, branch) => {
        asked.push([target, branch]);
        // @effect-diagnostics-next-line globalTimers:off
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ...change, number: 42 };
      },
    );
    expect(decision).toEqual({ allowed: true });
    expect(asked).toEqual([[repo, "fix/login"]]);
  });

  it.each([
    ["a branch no change was opened on", { ref: "refs/heads/fix-login" }, null],
    ["its open change's branch, named by it", { ref: "refs/heads/fix-login" }, change],
    [
      "a branch it named whose change settled",
      { ref: "refs/heads/fix-login" },
      { ...change, open: false },
    ],
    [
      "a branch another Mate's settled change was on",
      { ref: "refs/heads/fix-login" },
      { ...change, mateId: "bob", open: false },
    ],
  ] satisfies Array<[string, Partial<RefUpdate>, Change | null]>)(
    "allows a Mate to push %s",
    async (_name, patch, record) => {
      expect(await decide(mate, patch, record)).toEqual({ allowed: true });
    },
  );

  it("refuses a person the branch a Mate's open change is on, and leaves it theirs once settled", async () => {
    const person: Principal = { kind: "person", userId: "user", appId: "app" };
    const ref = { ref: "refs/heads/fix-login" };
    expect(await decide(person, ref, change)).toEqual({ allowed: false, reason: "protected_ref" });
    expect(await decide(person, ref, { ...change, open: false })).toEqual({ allowed: true });
  });

  it.each([
    ["reader", { kind: "reader", userId: "user" }, {}, change, "read_only"],
    ["other app", { ...mate, appId: "other" }, {}, change, "not_your_ref"],
    [
      "other mate",
      mate,
      { ref: "refs/heads/fix-login" },
      { ...change, mateId: "bob" },
      "not_your_ref",
    ],
    ["main", mate, { ref: "refs/heads/main" }, change, "protected_ref"],
    ["tag", mate, { ref: "refs/tags/v1" }, change, "protected_ref"],
    ["deletion", mate, { newSha: "0".repeat(40) }, change, "deletion"],
    [
      "core tag replacement",
      { kind: "core" },
      { ref: "refs/tags/v1", oldSha: "2".repeat(40) },
      change,
      "tag_immutable",
    ],
    ["core deletion", { kind: "core" }, { newSha: "0".repeat(64) }, change, "deletion"],
    ["unknown", mate, {}, null, "unknown_change"],
    ["closed", mate, {}, { ...change, open: false }, "change_closed"],
    ["another Mate's closed", mate, {}, { ...change, mateId: "bob", open: false }, "change_closed"],
    ["notes", mate, { ref: "refs/notes/review" }, null, "protected_ref"],
  ] satisfies Array<[string, Principal, Partial<RefUpdate>, Change | null, string]>)(
    "refuses %s",
    async (_name, principal, patch, record, reason) => {
      expect(await decide(principal, patch, record)).toEqual({ allowed: false, reason });
    },
  );

  it.each([
    "main",
    "refs//head",
    "refs/heads/.hidden",
    "refs/heads/a.lock",
    "refs/heads/a..b",
    "refs/heads/a@{b",
    "refs/heads/a b",
    "refs/heads/a\\b",
    "refs/heads/a~b",
    "refs/heads/a^b",
    "refs/heads/a:b",
    "refs/heads/a?b",
    "refs/heads/a*b",
    "refs/heads/a[b",
    "refs/heads/a\n",
    "refs/heads/a\u007f",
    "refs/heads/a.",
    "refs/heads/a/",
  ])("refuses invalid ref %j even for core", async (ref) => {
    expect(await decide({ kind: "core" }, { ref })).toEqual({
      allowed: false,
      reason: "invalid_ref",
    });
  });

  it("does not consult change lookup outside the mate's namespace", async () => {
    expect(
      await allowRefUpdate(mate, repo, { ...update, ref: "refs/heads/main" }, () => {
        throw new Error("unexpected lookup");
      }),
    ).toEqual({ allowed: false, reason: "protected_ref" });
  });
});
