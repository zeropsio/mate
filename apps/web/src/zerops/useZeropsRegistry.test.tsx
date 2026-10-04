import { RegistryContext } from "@effect/atom-react";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { hqStructureAtom, type HqStructureView } from "../state/zerops";
import { TestNode } from "./__fixtures__/testDom";

/** The organization in view. */
const session = vi.hoisted(() => ({ activeOrganization: { id: "org-1" } }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSession: () => session }));

const KNOWN: HqStructure = {
  ungrouped: [],
  apps: [
    {
      id: "shop",
      name: "Shop",
      projects: [
        {
          projectId: "p-vera",
          name: "Shop - Vera",
          kind: "mate",
          mate: { face: "" },
        },
        { projectId: "p-stage", name: "Shop - stage", kind: "stage", mate: null },
      ],
    },
  ],
};
const KNOWN_REGISTRY = {
  groups: [
    {
      groupId: "shop",
      name: "Shop",
      projects: [
        { projectId: "p-vera", kind: "mate" },
        { projectId: "p-stage", kind: "stage" },
      ],
    },
  ],
};

function view(over: Partial<HqStructureView>): HqStructureView {
  return {
    organizationId: "org-1",
    structure: KNOWN,
    changes: null,
    appReads: null,
    readAt: 1_000,
    current: true,
    unavailableSince: null,
    ...over,
  };
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

/** Draws the hook over the first view, then applies each later one in turn; every state it drew. */
async function renderRegistry(
  views: ReadonlyArray<HqStructureView | null>,
): Promise<ReadonlyArray<unknown>> {
  const document = installTestDom();
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useZeropsRegistry } = await import("./useZeropsRegistry");
  const atoms = AtomRegistry.make();
  atoms.set(hqStructureAtom, views[0] ?? null);
  const rendered: Array<ReturnType<typeof useZeropsRegistry>> = [];
  function Probe() {
    rendered.push(useZeropsRegistry());
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  try {
    await act(async () =>
      root.render(
        <RegistryContext value={atoms}>
          <Probe />
        </RegistryContext>,
      ),
    );
    for (const next of views.slice(1)) {
      await act(async () => atoms.set(hqStructureAtom, next));
    }
    return rendered;
  } finally {
    await act(async () => root.unmount());
  }
}

describe("useZeropsRegistry", () => {
  it.each<{
    readonly name: string;
    readonly views: ReadonlyArray<HqStructureView | null>;
    readonly expected: object;
  }>([
    {
      name: "nothing known yet reports loading, never a settled empty registry",
      views: [null],
      expected: { registry: { groups: [] }, loading: true },
    },
    {
      name: "the organization's structure, as HQ streams it",
      views: [view({})],
      expected: { registry: KNOWN_REGISTRY, loading: false },
    },
    {
      name: "HQ down leaves the registry last known standing",
      views: [view({}), view({ current: false, unavailableSince: 2_000 })],
      expected: { registry: KNOWN_REGISTRY, loading: false },
    },
    {
      name: "a change HQ streams is the registry at once",
      views: [view({ structure: { ungrouped: [], apps: [] } }), view({})],
      expected: { registry: KNOWN_REGISTRY, loading: false },
    },
    {
      name: "an organization with no HQ has the empty registry, known",
      views: [view({ structure: { ungrouped: [], apps: [] } })],
      expected: { registry: { groups: [] }, loading: false },
    },
    {
      name: "another organization's structure is never this one's",
      views: [view({ organizationId: "org-2" })],
      expected: { registry: { groups: [] }, loading: true },
    },
  ])("$name", async ({ views, expected }) => {
    const rendered = await renderRegistry(views);
    expect(rendered.at(-1)).toEqual(expected);
  });
});
