import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import { makeAccountStore, readsOfState } from "../../data/store.ts";
import { makeGitBrowseReads } from "../../data/adapters/hqGitBrowse.ts";
import { gitBrowse } from "../../data/projections/gitBrowse.ts";
import { HqError, makeHqApi, type HqApi } from "../hq/client.ts";
import { fileShape, fileSize, lineCount } from "./blob.ts";
import { parseLines, linesParam } from "./lineRange.ts";
import { heldType } from "./raw.ts";
import { folderReads, foldersAbove } from "./tree.ts";

const sha = "a".repeat(40);
const target = {
  orgId: "org",
  appId: "app",
  repo: "repo",
  read: "blob" as const,
  params: { sha, path: "a" },
};
const value: GitBlob = {
  path: "a",
  blobSha: "b".repeat(40),
  size: 5,
  binary: false,
  content: "hello",
  truncated: false,
};
const bytes = { gitBrowseBytes: async () => new Blob() } satisfies Pick<HqApi, "gitBrowseBytes">;
function waitFor(store: ReturnType<typeof makeAccountStore>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    const stop = store.subscribe(check);
    check();
  });
}

describe("HQ repository source", () => {
  it("deduplicates demand, retains commit-pinned facts, and only retries a failure on an explicit again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reads = 0;
    const reader = makeGitBrowseReads(store, {
      ...bytes,
      gitBrowse: async () => {
        reads++;
        return value as never;
      },
    });
    const projected = store.data.project(gitBrowse, { ...target, allowed: true });
    const done = waitFor(store, () => registry.get(projected).state === "known");
    const release = reader.demand(target);
    await done;
    expect(registry.get(projected)).toMatchObject({ state: "known", answer: value });
    expect(
      registry.get(store.data.project(gitBrowse, { ...target, allowed: undefined })),
    ).toMatchObject({ state: "withheld" });
    release();
    const releaseAgain = reader.demand(target);
    expect(reads).toBe(1);
    releaseAgain();
    reader.close();
    registry.dispose();
  });
  it("keeps a refused read final on remount and retries only on Again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reads = 0;
    const reader = makeGitBrowseReads(store, {
      ...bytes,
      gitBrowse: async () => {
        reads++;
        throw new HqError({ kind: "refused", code: "path_not_found", message: "No such file." });
      },
    });
    const projected = store.data.project(gitBrowse, { ...target, allowed: true });
    const done = waitFor(store, () => registry.get(projected).state === "refused");
    const release = reader.demand(target);
    await done;
    release();
    const again = reader.demand(target);
    expect(reads).toBe(1);
    const retried = waitFor(
      store,
      () => reads === 2 && registry.get(projected).state === "refused",
    );
    reader.again(target);
    await retried;
    expect(registry.get(projected)).toMatchObject({ state: "refused", reason: "path_not_found" });
    again();
    reader.close();
    registry.dispose();
  });
  it("drops a read that completes after the account closes", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let resolve!: (answer: GitBlob) => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const reader = makeGitBrowseReads(store, {
      ...bytes,
      gitBrowse: () => {
        started();
        return new Promise((r) => {
          resolve = r as never;
        });
      },
    });
    reader.demand(target);
    await entered;
    reader.close();
    resolve(value);
    expect(store.state().facts.size).toBe(0);
    registry.dispose();
  });
});

it("projects retained source and its reread state, withholding content when access is denied", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let fail = false;
  const reader = makeGitBrowseReads(store, {
    ...bytes,
    gitBrowse: async () => {
      if (fail) throw new HqError({ kind: "refused", code: "path_not_found", message: "No." });
      return value as never;
    },
  });
  const projected = store.data.project(gitBrowse, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  fail = true;
  const stale = waitFor(store, () => {
    const view = registry.get(projected);
    return view.state === "known" && view.failed;
  });
  reader.again(target);
  await stale;
  expect(registry.get(projected)).toMatchObject({ state: "known", answer: value, failed: true });
  expect(registry.get(store.data.project(gitBrowse, { ...target, allowed: false }))).toMatchObject({
    state: "withheld",
  });
  release();
  reader.close();
  registry.dispose();
});
it("withholds retained content when the source refuses access, and forgets it when the account closes", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let deny = false;
  const reader = makeGitBrowseReads(store, {
    ...bytes,
    gitBrowse: async () => {
      if (deny) throw new HqError({ kind: "refused", code: "forbidden", message: "No access." });
      return value as never;
    },
  });
  const projected = store.data.project(gitBrowse, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  deny = true;
  const withheld = waitFor(store, () => registry.get(projected).state === "withheld");
  reader.again(target);
  await withheld;
  expect(registry.get(projected)).toMatchObject({ state: "withheld" });
  release();
  reader.close();
  registry.dispose();
});
it("withholds cached source synchronously when the current grant is denied or unread", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reader = makeGitBrowseReads(store, { ...bytes, gitBrowse: async () => value as never });
  const projected = store.data.project(gitBrowse, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  for (const allowed of [undefined, false])
    expect(
      registry.get(store.data.project(gitBrowse, { ...target, allowed })),
      String(allowed),
    ).toMatchObject({ state: "withheld" });
  release();
  reader.close();
  registry.dispose();
});

it("a retry reads the new grant even when the obsolete repository request is denied", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let entered!: () => void;
  let denied!: (cause: unknown) => void;
  const first = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const reads = makeGitBrowseReads(store, {
    ...bytes,
    gitBrowse: () =>
      ++calls === 1
        ? new Promise((_resolve, reject) => {
            entered();
            denied = reject;
          })
        : Promise.resolve(value as never),
  });
  const release = reads.demand(target);
  await first;
  const done = waitFor(
    store,
    () =>
      gitBrowse.derive(readsOfState(store.state()), { ...target, allowed: true }).state === "known",
  );
  reads.again(target);
  denied(new HqError({ kind: "refused", code: "forbidden", message: "Old grant denied." }));
  await done;
  expect(calls).toBe(2);
  release();
  reads.close();
  registry.dispose();
});

describe("HQ source client", () => {
  it("escapes each id and query and never automatically repeats a failed source read", async () => {
    const calls: string[] = [];
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "own", expiresAt: "later" }), {
            status: 200,
          });
        throw new TypeError("offline");
      },
    });
    await expect(
      api.gitBrowse("blob", "a/b", "code", { sha, path: "src/a b.ts" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(2);
    const request = new URL(calls[1]!);
    expect(request.pathname).toBe("/api/apps/a%2Fb/repos/code/browse/blob");
    expect(Object.fromEntries(request.searchParams)).toEqual({ path: "src/a b.ts", sha });
  });
  it("renews an expired session through the door within the same attempt", async () => {
    const calls: string[] = [];
    let kept: string | null = "expired";
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      kept: {
        read: () => kept,
        keep: ({ token }) => {
          kept = token;
        },
        forget: () => {
          kept = null;
        },
      },
      fetch: async (url, init) => {
        calls.push(url);
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "fresh", expiresAt: "later" }), {
            status: 200,
          });
        if (new Headers(init?.headers).get("authorization") === "Bearer expired")
          return new Response(JSON.stringify({ code: "session_required" }), { status: 401 });
        return new Response(JSON.stringify({ entries: [], truncated: false }), { status: 200 });
      },
    });
    await expect(api.gitBrowse("tree", "app", "code", { sha, path: "" })).resolves.toEqual({
      entries: [],
      truncated: false,
    });
    expect(calls).toHaveLength(3);
    expect(kept).toBe("fresh");
  });
  it.each([
    ["text/html; charset=utf-8", "application/octet-stream"],
    ["text/plain; charset=utf-8", "text/plain;charset=utf-8"],
    ["image/svg+xml", "application/octet-stream"],
    ["image/png", "image/png"],
    [null, "application/octet-stream"],
  ])(
    "A file's bytes HQ sends as %s are held as %s, so opening them runs nothing",
    async (sent, held) => {
      const api = makeHqApi({
        address: "https://hq.example",
        throughDoor: async (use) => use("door"),
        openSocket: () => {
          throw new Error("unused");
        },
        fetch: async (url) =>
          url.endsWith("/api/door")
            ? new Response(JSON.stringify({ session: "own", expiresAt: "later" }), { status: 200 })
            : new Response(new Uint8Array([60, 98, 62]), {
                status: 200,
                headers: sent === null ? {} : { "content-type": sent },
              }),
      });
      const blob = await api.gitBrowseBytes("raw", "app", "code", { sha, path: "a.html" });
      expect(blob.type).toBe(held);
      expect(heldType(sent)).toBe(held);
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([60, 98, 62]);
    },
  );
});

describe("Git browser file helpers", () => {
  it.each([
    ["L10", { start: 10, end: 10 }, "L10"],
    ["L20-L10", { start: 10, end: 20 }, "L10-L20"],
    ["L0", null, null],
    ["10", null, null],
  ])("The line link %s reads as %o", (lines, range, written) => {
    expect(parseLines(lines)).toEqual(range);
    expect(range === null ? null : linesParam(range)).toBe(written);
  });
  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [262_144, "256 KiB"],
    [300_000, "293.0 KiB"],
    [2 * 1024 * 1024 + 1, "2.0 MiB"],
  ])("A size of %i bytes reads as %s", (size, words) => {
    expect(fileSize(size)).toBe(words);
  });
  it.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\r\nb\r\n", 2],
  ])("%j has %i lines", (content, lines) => {
    expect(lineCount(content)).toBe(lines);
  });
  it.each([
    [{ path: "a.png", size: 10, binary: true, content: null }, "image"],
    [{ path: "a.png", size: 2 * 1024 * 1024, binary: true, content: null }, "beyond"],
    [{ path: "a.bin", size: 10, binary: true, content: null }, "binary"],
    [{ path: "a.bin", size: 2 * 1024 * 1024, binary: true, content: null }, "beyond"],
    [{ path: "a.ts", size: 2 * 1024 * 1024, binary: false, content: "x" }, "text"],
  ])("A file %o is drawn as %s", (blob, kind) => {
    expect(fileShape({ blobSha: "c".repeat(40), truncated: false, ...blob }).kind).toBe(kind);
  });
  it("Opening a deep path reads every folder above it, at most four at a time", () => {
    expect(foldersAbove("a/b/c/d/e.ts")).toEqual(["", "a", "a/b", "a/b/c", "a/b/c/d"]);
    const opened = foldersAbove("a/b/c/d/e.ts");
    expect(folderReads(opened, () => "waiting")).toEqual(["", "a", "a/b", "a/b/c"]);
    expect(
      folderReads(opened, (folder) =>
        folder === "" ? "read" : folder === "a" ? "reading" : "waiting",
      ),
    ).toEqual(["", "a", "a/b", "a/b/c", "a/b/c/d"]);
  });
});
