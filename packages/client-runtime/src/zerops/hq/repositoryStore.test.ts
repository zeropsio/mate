import { describe, expect, it } from "@effect/vitest";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import { makeRepositoryStore } from "./repositoryStore.ts";
import { HqError } from "./client.ts";

const target = { appId: "app", repo: "code", query: { path: "", kind: "tree" as const } };
const source: RepositorySource = {
  kind: "tree",
  revision: "a".repeat(40),
  path: "",
  branches: [],
  branchesTruncated: false,
  entries: [],
  truncated: false,
};
describe("repository source owner", () => {
  it("deduplicates demand, retains commit-pinned facts, and only retries a failure on an explicit again", async () => {
    let calls = 0;
    const store = makeRepositoryStore({
      read: async () => {
        calls++;
        if (calls === 1) throw new Error("offline");
        return source;
      },
      now: () => 1,
    });
    expect(store.snapshot(target).state).toBe("unread");
    const first = store.load(target);
    await Promise.all([first, store.load(target)]);
    expect(calls).toBe(1);
    expect(store.snapshot(target).state).toBe("failed");
    await store.load(target);
    expect(calls).toBe(1);
    await store.again(target);
    expect(calls).toBe(2);
    expect(store.snapshot(target)).toMatchObject({ state: "known", value: source });
    await store.load(target);
    expect(calls).toBe(2);
  });
  it("withholds retained content when the source refuses access, and forgets it when the account closes", async () => {
    let denied = false;
    const store = makeRepositoryStore({
      read: async () => {
        if (denied) throw new HqError({ kind: "refused", code: "forbidden", message: "No access" });
        return source;
      },
      now: () => 1,
    });
    await store.load(target);
    denied = true;
    await store.again(target);
    expect(store.snapshot(target).state).toBe("withheld");
    store.close();
    expect(store.snapshot(target).state).toBe("unread");
  });
  it("drops a read that completes after the account closes", async () => {
    let complete!: (source: RepositorySource) => void;
    const store = makeRepositoryStore({
      read: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      now: () => 1,
    });
    const attempt = store.load(target);
    store.close();
    complete(source);
    await attempt;
    expect(store.snapshot(target).state).toBe("unread");
  });
  it("withholds cached source synchronously when the current grant is denied or unread", async () => {
    const store = makeRepositoryStore({ read: async () => source, now: () => 1 });
    await store.load(target);
    expect(store.snapshot(target, false).state).toBe("withheld");
    expect(store.snapshot(target, "unread").state).toBe("unread");
    expect(store.snapshot(target, true)).toMatchObject({ state: "known", value: source });
  });
});
