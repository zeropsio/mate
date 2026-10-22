import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { HqApi } from "../../zerops/hq/client.ts";
import type { GitBrowseKey } from "../families/hqGitBrowse.ts";
import { gitBrowse } from "../projections/gitBrowse.ts";
import { makeAccountStore } from "../store.ts";
import { makeGitBrowseReads } from "./hqGitBrowse.ts";

const sha = "a".repeat(40);
const archive: GitBrowseKey = {
  orgId: "org",
  appId: "app",
  repo: "shop",
  read: "archive",
  params: { sha, format: "zip" },
};
const tree: GitBrowseKey = {
  orgId: "org",
  appId: "app",
  repo: "shop",
  read: "tree",
  params: { sha, path: "" },
};

/** HQ answering each read with a new answer, counting what it was asked. */
const hq = () => {
  const asked: string[] = [];
  const answers: unknown[] = [];
  const answer = (read: string, value: unknown) => {
    asked.push(read);
    answers.push(value);
    return Promise.resolve(value as never);
  };
  const api: Pick<HqApi, "gitBrowse" | "gitBrowseBytes"> = {
    gitBrowse: (read) => answer(read, { entries: [], truncated: false }),
    gitBrowseBytes: (read) => answer(read, new Blob([new Uint8Array(3 * 1024 * 1024)])),
  };
  return { api, asked, answers };
};

describe("Git browser reads", () => {
  it.each([
    ["an archive", archive],
    ["a tree", tree],
  ])(
    "A released Git browser read returns to unknown and its answer is no longer held: %s",
    async (_name, key) => {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const { api, asked, answers } = hq();
      const reader = makeGitBrowseReads(store, api);
      const projected = store.data.project(gitBrowse, { ...key, allowed: true });
      const unmount = registry.mount(projected);
      const known = () =>
        new Promise<void>((resolve) => {
          const stop = store.subscribe(() => {
            if (registry.get(projected).state !== "known") return;
            stop();
            resolve();
          });
        });
      const first = known();
      const release = reader.demand(key);
      await first;
      const held = answers[0];
      expect(registry.get(projected)).toMatchObject({ state: "known", answer: held });

      release();

      expect(registry.get(projected)).toEqual({ state: "unread", busy: false });
      expect(
        [...store.state().facts.values()].some(
          (fact) => fact.content.kind === "value" && fact.content.value === held,
        ),
      ).toBe(false);
      // Visited again, the read asks HQ again: a released answer is never drawn from memory.
      const again = known();
      const second = reader.demand(key);
      await again;
      expect(asked).toEqual([key.read, key.read]);
      second();
      unmount();
      reader.close();
    },
  );
});
