import { RegistryContext } from "@effect/atom-react";
import { gitBrowse, makeAccountStore } from "@t3tools/client-runtime/data";
import type { GitTree } from "@t3tools/shared/hqGitBrowse/tree";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useGitBrowseReads } from "./useGitBrowse";

const account = vi.hoisted(() => ({
  store: null as import("@t3tools/client-runtime/data").AccountStore | null,
  hq: { api: { gitBrowse: vi.fn(), gitBrowseBytes: vi.fn() } },
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountStoreForAdapters: () => account.store,
  useAccountOrgId: () => "org",
}));
vi.mock("./accountHq", () => ({ useOfficialHq: () => account.hq }));

let registry: ReturnType<typeof AtomRegistry.make>;
let tree: ReactTestRenderer;
const request = (path: string) => ({
  appId: "app",
  repo: "repo",
  read: "tree" as const,
  params: { sha: "a".repeat(40), path },
});
const answer: GitTree = {
  entries: [{ name: "src", path: "src", type: "folder", mode: "040000", sha: "b".repeat(40) }],
  truncated: false,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("git-tree");
  registry = AtomRegistry.make();
  account.store = makeAccountStore(registry);
  account.hq.api.gitBrowse.mockResolvedValue(answer);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  closeAccountLifetime();
  account.store?.close();
  registry.dispose();
  account.hq.api.gitBrowse.mockReset();
});

it.each(["src", "src/[locale]/(checkout)"])(
  "Opening another folder keeps the existing listing visible: %s",
  async (path) => {
    function View({ paths }: { paths: string[] }) {
      const { views } = useGitBrowseReads(paths.map(request), true);
      return createElement(
        "span",
        null,
        views[0]?.state === "known" ? views[0].answer.entries[0]?.path : "unread",
      );
    }
    const view = (paths: string[]) =>
      createElement(RegistryContext.Provider, { value: registry }, createElement(View, { paths }));
    await act(async () => {
      tree = create(view([""]));
    });
    expect(tree.toJSON()).toMatchObject({ children: ["src"] });
    const projected = account.store!.data.project(gitBrowse, {
      ...request(""),
      orgId: "org",
      allowed: true,
    });
    const states: string[] = [];
    const stop = account.store!.subscribe(() => states.push(registry.get(projected).state));
    // The next listing arrives later; existing folders must not disappear while it is pending.
    let finish!: (answer: GitTree) => void;
    account.hq.api.gitBrowse.mockImplementation(
      () =>
        new Promise<GitTree>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => tree.update(view(["", path])));
    expect(states).not.toContain("unread");
    expect(tree.toJSON()).toMatchObject({ children: ["src"] });
    expect(account.hq.api.gitBrowse).toHaveBeenCalledTimes(2);
    await act(async () => finish({ entries: [], truncated: false }));
    stop();
    await act(async () => tree.unmount());
    expect(registry.get(projected).state).toBe("unread");
  },
);
