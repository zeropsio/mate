import { RegistryContext } from "@effect/atom-react";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
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

/** What HQ's navigation said of an organization: its structure, and whether HQ answers now. */
interface View {
  readonly organizationId: string;
  readonly structure: HqStructure;
  readonly live: boolean;
}

function view(over: Partial<View>): View {
  return { organizationId: "org-1", structure: KNOWN, live: true, ...over };
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
async function renderRegistry(views: ReadonlyArray<View | null>): Promise<ReadonlyArray<unknown>> {
  const document = installTestDom();
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useZeropsRegistry } = await import("./useZeropsRegistry");
  const atoms = AtomRegistry.make();
  let mounted: ReturnType<typeof mountHqNavigation> | null = null;
  const show = (next: View | null) => {
    if (next === null) return;
    const seed = { structure: next.structure, live: next.live };
    if (mounted === null) mounted = mountHqNavigation(atoms, next.organizationId, seed);
    else mounted.seed(seed);
  };
  show(views[0] ?? null);
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
      await act(async () => show(next));
    }
    return rendered;
  } finally {
    await act(async () => root.unmount());
  }
}

describe("useZeropsRegistry", () => {
  it.each<{
    readonly name: string;
    readonly views: ReadonlyArray<View | null>;
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
      views: [view({}), view({ live: false })],
      expected: { registry: KNOWN_REGISTRY, loading: false },
    },
    {
      name: "a change HQ streams is the registry at once",
      views: [view({ structure: { ungrouped: [], apps: [] } }), view({})],
      expected: { registry: KNOWN_REGISTRY, loading: false },
    },
    {
      name: "an empty structure from HQ is the empty registry, known",
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
