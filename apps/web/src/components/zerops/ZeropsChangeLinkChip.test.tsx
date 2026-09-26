import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../../zerops/__fixtures__/testDom";
import type { ZeropsProjectFlowValue } from "../../zerops/projectFlowContext";
import type {
  ZeropsLandedChangeRequest,
  ZeropsLandedChangeState,
} from "../../zerops/useZeropsLandedChange";

/** What the forge answers for a landed change, once the chip asks for it. */
const forge = vi.hoisted(() => ({
  answer: { kind: "reading" } as ZeropsLandedChangeState,
}));

vi.mock("../../zerops/useZeropsLandedChange", () => ({
  useZeropsLandedChange: (request: ZeropsLandedChangeRequest | null) =>
    request === null ? { kind: "idle" } : forge.answer,
}));

// The test DOM draws no SVG; the icon says nothing the text does not.
vi.mock("lucide-react", () => ({ GitPullRequestArrow: () => null, GitMergeIcon: () => null }));

const ORIGIN = "https://gitea.example.test";
const HREF = `${ORIGIN}/zit/zitdev/pulls/31`;
const LANDED = {
  repository: "zitdev",
  number: 31,
  line: "Cache the link previews",
  merged: true,
} as unknown as FlowPullRequest;

/** The flow as a chip reads it: this Gitea, the orgs the registry names, and the asking verb. */
function flowValue(
  slugs: ReadonlyArray<readonly [string, string]>,
  askForOwner: (owner: string) => void,
): ZeropsProjectFlowValue {
  return {
    giteaOrigin: ORIGIN,
    flows: new Map(),
    slugs: new Map(slugs as ReadonlyArray<[string, string]>),
    askForOwner,
  } as unknown as ZeropsProjectFlowValue;
}

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    Element: TestNode,
    HTMLElement: TestNode,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  // The state's words are a tooltip's, and the tooltip asks what an Element is.
  vi.stubGlobal("Element", TestNode);
  vi.stubGlobal("HTMLElement", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document;
}

afterEach(() => {
  forge.answer = { kind: "reading" };
  vi.unstubAllGlobals();
});

/**
 * A Mate links a change the moment it opens it, often on a project made since the page loaded:
 * the registry does not name its Gitea org yet. The link is drawn as the change from its address
 * at once, asks for the org, and takes its word once the org is known — never a bare url until a
 * reload.
 */
describe("ZeropsChangeLinkChip", () => {
  it.each<{
    readonly name: string;
    readonly href?: string;
    /** What the registry names and the forge answers, render by render. */
    readonly renders: ReadonlyArray<{
      readonly slugs: ReadonlyArray<readonly [string, string]>;
      readonly answer?: ZeropsLandedChangeState;
    }>;
    readonly text: string;
    readonly asked: ReadonlyArray<string>;
  }>([
    {
      name: "an owner the registry does not name is drawn from the url and asked for once",
      renders: [{ slugs: [] }],
      text: "zitdev #31",
      asked: ["zit"],
    },
    {
      name: "an owner the registry comes to name gives the chip its word",
      renders: [{ slugs: [] }, { slugs: [["g1", "zit"]], answer: { kind: "read", pull: LANDED } }],
      text: "Cache the link previews, Landed",
      asked: ["zit"],
    },
    {
      name: "an owner that stays unknown across renders is asked for once",
      renders: [{ slugs: [] }, { slugs: [["g1", "shop"]] }, { slugs: [["g1", "shop"]] }],
      text: "zitdev #31",
      asked: ["zit"],
    },
    {
      name: "an owner the registry names is not asked for",
      renders: [{ slugs: [["g1", "zit"]], answer: { kind: "read", pull: LANDED } }],
      text: "Cache the link previews, Landed",
      asked: [],
    },
    {
      name: "a change on another forge stays the link it was",
      href: "https://github.com/zit/zitdev/pull/31",
      renders: [{ slugs: [] }],
      text: "https://github.com/zit/zitdev/pull/31",
      asked: [],
    },
  ])("$name", async ({ href = HREF, renders, text, asked }) => {
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ZeropsProjectFlowContext } = await import("../../zerops/projectFlowContext");
    const { ZeropsChangeLinkChip } = await import("./ZeropsChangeLinkChip");
    const askForOwner = vi.fn<(owner: string) => void>();
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    try {
      for (const { slugs, answer } of renders) {
        forge.answer = answer ?? { kind: "reading" };
        const value = flowValue(slugs, askForOwner);
        await act(async () =>
          root.render(
            <ZeropsProjectFlowContext.Provider value={value}>
              <ZeropsChangeLinkChip href={href}>{href}</ZeropsChangeLinkChip>
            </ZeropsProjectFlowContext.Provider>,
          ),
        );
      }
      expect(container.textContent).toBe(text);
      expect(askForOwner.mock.calls.map(([owner]) => owner)).toEqual(asked);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each([
    [
      "landed after the message was written",
      "2026-09-20T10:00:00.000Z",
      ", Landed, landed since this message",
    ],
    ["landed before it", "2026-09-20T12:00:00.000Z", ", Landed"],
  ])("marks a change that %s", async (_label, writtenAt, tail) => {
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ZeropsProjectFlowContext } = await import("../../zerops/projectFlowContext");
    const { ChangeChipMomentContext, ZeropsChangeLinkChip } =
      await import("./ZeropsChangeLinkChip");
    forge.answer = {
      kind: "read",
      pull: { ...LANDED, mergedAt: "2026-09-20T11:00:00.000Z" } as FlowPullRequest,
    };
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    const value = flowValue([["g1", "zit"]], () => {});
    try {
      await act(async () =>
        root.render(
          <ZeropsProjectFlowContext.Provider value={value}>
            <ChangeChipMomentContext value={writtenAt}>
              <ZeropsChangeLinkChip href={HREF}>{HREF}</ZeropsChangeLinkChip>
            </ChangeChipMomentContext>
          </ZeropsProjectFlowContext.Provider>,
        ),
      );
      expect(container.textContent).toBe(`Cache the link previews${tail}`);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
