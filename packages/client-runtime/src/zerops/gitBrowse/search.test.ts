import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { GitGrep } from "@t3tools/shared/hqGitBrowse/grep";
import { makeAccountStore } from "../../data/store.ts";
import { makeGitBrowseReads } from "../../data/adapters/hqGitBrowse.ts";
import { gitBrowseLink } from "../../data/families/hqGitBrowse.ts";
import { gitBrowse } from "../../data/projections/gitBrowse.ts";
import { streamOf } from "../../data/reducer.ts";
import { HqError } from "../hq/client.ts";
import { grepFiles } from "./grep.ts";
import { gitBrowsePath } from "./reads.ts";

const sha = "a".repeat(40);
const key = {
  orgId: "org",
  appId: "app",
  repo: "repo",
  read: "grep" as const,
  params: { sha, q: "tea", mode: "regex" as const },
};
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

describe("Git browser search reads", () => {
  it("A search HQ answers busy says HQ is busy and is read again on the person's ask", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const asked: Array<string> = [];
    const found: GitGrep = {
      matches: [{ path: "a.ts", line: 1, text: "tea", ranges: [{ start: 0, end: 3 }] }],
      truncated: false,
      deadlineHit: false,
    };
    const reader = makeGitBrowseReads(store, {
      gitBrowse: async (read, appId, repo, params) => {
        asked.push(gitBrowsePath(read, appId, repo, params));
        if (asked.length === 1)
          throw new HqError({
            kind: "unavailable",
            code: "busy",
            status: 503,
            message: "HQ is not answering right now.",
          });
        return found;
      },
      gitBrowseBytes: async () => new Blob(),
    });
    const projected = store.data.project(gitBrowse, { ...key, allowed: true });
    // HQ said busy, and the read waits to be tried again.
    const failed = waitFor(
      store,
      () => streamOf(store.state(), gitBrowseLink(key)).phase === "recovering",
    );
    const release = reader.demand(key);
    await failed;
    expect(registry.get(projected)).toEqual({
      state: "failed",
      words: "HQ is busy with other searches. Read again in a moment.",
    });
    expect(asked).toEqual([`/api/apps/app/repos/repo/browse/grep?mode=regex&q=tea&sha=${sha}`]);
    const known = waitFor(store, () => registry.get(projected).state === "known");
    reader.again(key);
    await known;
    expect(registry.get(projected)).toMatchObject({ state: "known", answer: found });
    expect(asked).toHaveLength(2);
    release();
    reader.close();
    registry.dispose();
  });

  it("Search results are grouped per file in HQ's order", () => {
    const line = (path: string, n: number) => ({ path, line: n, text: "tea", ranges: [] });
    expect(grepFiles([line("b.ts", 3), line("b.ts", 9), line("a.ts", 1)])).toEqual([
      { path: "b.ts", matches: [line("b.ts", 3), line("b.ts", 9)] },
      { path: "a.ts", matches: [line("a.ts", 1)] },
    ]);
  });
});
