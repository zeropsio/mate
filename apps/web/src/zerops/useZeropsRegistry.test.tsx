import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

/** The account's Gitea project as the store holds it: its tags are the registry. */
const gitea = (tagList: ReadonlyArray<string>, clientId = "org-a"): ZeropsProject =>
  ({ id: "gitea-a", clientId, name: "Headquarters", tagList }) as unknown as ZeropsProject;
const TOOL = "mate:tool:gitea";
const SHOP = "mate:gn:g1:shop";
const DOCK = "mate:gn:g2:dock";

/** What the inventory holds at one render: its projects, and whether its read is still out. */
interface Held {
  readonly projects: ReadonlyArray<ZeropsProject> | null;
  readonly loading?: boolean;
  readonly clientId?: string;
}

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useZeropsRegistry — the registry is the store's Gitea project's tags", () => {
  it.each<{
    readonly name: string;
    readonly renders: ReadonlyArray<Held>;
    readonly slugs: ReadonlyArray<string>;
    readonly loading: boolean;
  }>([
    {
      name: "a pushed group-name tag is a group at once",
      renders: [{ projects: [gitea([TOOL, SHOP])] }, { projects: [gitea([TOOL, SHOP, DOCK])] }],
      slugs: ["dock", "shop"],
      loading: false,
    },
    {
      name: "the Gitea project missing for a moment keeps the registry it last had",
      renders: [{ projects: [gitea([TOOL, SHOP])] }, { projects: [], loading: true }],
      slugs: ["shop"],
      loading: false,
    },
    {
      name: "a blink past a settled inventory keeps it too",
      renders: [{ projects: [gitea([TOOL, SHOP])] }, { projects: [] }],
      slugs: ["shop"],
      loading: false,
    },
    {
      name: "another organization never sees the one before's registry",
      renders: [
        { projects: [gitea([TOOL, SHOP])] },
        { projects: [], clientId: "org-b", loading: true },
      ],
      slugs: [],
      loading: true,
    },
    {
      name: "no Gitea project yet while the inventory is read is loading, never settled empty",
      renders: [{ projects: [], loading: true }],
      slugs: [],
      loading: true,
    },
    {
      name: "an account with no Gitea project has the empty registry",
      renders: [{ projects: [] }],
      slugs: [],
      loading: false,
    },
    {
      name: "the Gitea project of another organization is not this one's",
      renders: [{ projects: [gitea([TOOL, SHOP], "org-b")] }],
      slugs: [],
      loading: false,
    },
    {
      name: "signed out holds nothing",
      renders: [{ projects: [gitea([TOOL, SHOP])] }, { projects: null }],
      slugs: [],
      loading: false,
    },
  ])("$name", async ({ renders, slugs, loading }) => {
    const document = installTestDom();
    // Nothing is read: the registry is what the store already holds.
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { HeldInventoryContext, InventoryContext } = await import("./inventoryContext");
    const { useZeropsRegistry } = await import("./useZeropsRegistry");
    const rendered: Array<ReturnType<typeof useZeropsRegistry>> = [];

    function Probe(props: { readonly clientId: string }) {
      rendered.push(useZeropsRegistry(props.clientId));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      for (const held of renders) {
        const value =
          held.projects === null ? null : { projects: held.projects, services: new Map() };
        const inventory =
          held.projects === null ? null : { isLoading: held.loading ?? false, ...value };
        await act(async () =>
          root.render(
            <InventoryContext value={inventory as never}>
              <HeldInventoryContext value={value}>
                <Probe clientId={held.clientId ?? "org-a"} />
              </HeldInventoryContext>
            </InventoryContext>,
          ),
        );
      }
      const last = rendered.at(-1)!;
      expect(last.registry.groups.map((group) => group.slug)).toEqual(slugs);
      expect(last.loading).toBe(loading);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
