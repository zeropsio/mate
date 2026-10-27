import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, press, TestNode } from "../../zerops/__fixtures__/testDom";
import type { LinkedChangeState } from "../../zerops/useLinkedChange";

/** What HQ answers for a change the flow does not carry, and the change the chip last asked for. */
const hq = vi.hoisted(() => ({
  answer: { kind: "reading" } as LinkedChangeState,
  asked: null as ChangeLink | null,
  readAgain: vi.fn(),
}));

vi.mock("../../zerops/useLinkedChange", () => ({
  useLinkedChange: (link: ChangeLink | null) => {
    hq.asked = link;
    return link === null
      ? { kind: "idle" }
      : {
          ...hq.answer,
          ...(hq.answer.kind === "gone" || hq.answer.kind === "unavailable"
            ? { readAgain: hq.readAgain }
            : {}),
        };
  },
}));

// The test DOM draws no SVG; the icon says nothing the text does not.
vi.mock("lucide-react", () => ({
  GitPullRequestArrow: () => null,
  GitPullRequestClosed: () => null,
  GitMergeIcon: () => null,
}));

const HQ = "https://hq.example.test";
const HREF = `${HQ}/changes/g1/zitdev/31`;
const LANDED = {
  repository: "zitdev",
  number: 31,
  line: "Cache the link previews",
  merged: true,
} as unknown as FlowPullRequest;
/** F16 (e2e, 2026-10-03): closed without merging, its last word on main a conflict. */
const CLOSED = {
  repository: "zitdev",
  number: 31,
  line: "Cache the link previews",
  merged: false,
  state: "closed",
  mergeability: "conflicting",
  behind: false,
} as unknown as FlowPullRequest;

/** The changes as a chip reads them: the official HQ once its anchor is resolved, and `g1`'s landed. */
function flowValue(hqAddress: string | undefined, merged: ReadonlyArray<FlowPullRequest> = []) {
  return { hqAddress, changes: new Map([["g1", { pullRequests: [], merged }]]) };
}

const shown = vi.hoisted(() => ({
  value: { hqAddress: undefined, changes: new Map() } as {
    readonly hqAddress: string | undefined;
    readonly changes: ReadonlyMap<string, unknown>;
  },
}));
vi.mock("../../zerops/projectFlows", () => ({
  useHqAddress: () => shown.value.hqAddress,
  useAppsChanges: () => shown.value,
}));

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
  hq.answer = { kind: "reading" };
  hq.asked = null;
  hq.readAgain.mockClear();
  vi.unstubAllGlobals();
});

/**
 * A Mate links a change after HQ records its push. The link is drawn as the change from its address
 * at once — the application, the repository and the number are in it — and takes its word from
 * the flow, or from HQ for one the flow does not carry: never a bare url until a reload.
 */
describe("ZeropsChangeLinkChip", () => {
  it.each<{
    readonly name: string;
    readonly href?: string;
    /** The official HQ and what it answers, render by render. */
    readonly renders: ReadonlyArray<{
      readonly hqAddress: string | undefined;
      readonly merged?: ReadonlyArray<FlowPullRequest>;
      readonly answer?: LinkedChangeState;
    }>;
    readonly text: string;
  }>([
    {
      name: "a change HQ is still reading is drawn from its address",
      renders: [{ hqAddress: HQ }],
      text: "zitdev #31",
    },
    {
      name: "a change HQ reads gives the chip its word",
      renders: [{ hqAddress: HQ }, { hqAddress: HQ, answer: { kind: "read", pull: LANDED } }],
      text: "Cache the link previews, Landed",
    },
    {
      name: "a change the flow carries gives the chip its word",
      renders: [{ hqAddress: HQ, merged: [LANDED] }],
      text: "Cache the link previews, Landed",
    },
    {
      name: "a change closed without merging says so, never what it last conflicted with",
      renders: [{ hqAddress: HQ, merged: [CLOSED] }],
      text: "Cache the link previews, Closed without merging",
    },
    {
      name: "a change HQ reads closed without merging says so",
      renders: [{ hqAddress: HQ }, { hqAddress: HQ, answer: { kind: "read", pull: CLOSED } }],
      text: "Cache the link previews, Closed without merging",
    },
    {
      name: "a link drawn before the official HQ is known stays the link it was",
      renders: [{ hqAddress: undefined }],
      text: HREF,
    },
    {
      name: "a link drawn before the official HQ is known becomes the change once it is",
      renders: [{ hqAddress: undefined }, { hqAddress: HQ }],
      text: "zitdev #31",
    },
    {
      name: "a change HQ does not have stays the link it was",
      renders: [{ hqAddress: HQ, answer: { kind: "gone" } }],
      text: `${HREF}zitdev has no change #31Read again`,
    },
    {
      name: "a change on another HQ stays the link it was",
      href: "https://hq.elsewhere.test/changes/g1/zitdev/31",
      renders: [{ hqAddress: HQ }],
      text: "https://hq.elsewhere.test/changes/g1/zitdev/31",
    },
  ])("$name", async ({ href = HREF, renders, text }) => {
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ZeropsChangeLinkChip } = await import("./ZeropsChangeLinkChip");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    try {
      for (const { hqAddress, merged, answer } of renders) {
        hq.answer = answer ?? { kind: "reading" };
        shown.value = flowValue(hqAddress, merged);
        await act(async () =>
          root.render(<ZeropsChangeLinkChip href={href}>{href}</ZeropsChangeLinkChip>),
        );
      }
      expect(container.textContent).toBe(text);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(["gone", "unavailable", "refused"] as const)(
    "shows %s and keeps recovery manual",
    async (kind) => {
      const document = installTestDom();
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { ZeropsChangeLinkChip } = await import("./ZeropsChangeLinkChip");
      const container = document.createElement("div");
      const root = createRoot(container as unknown as Element);
      shown.value = flowValue(HQ);
      hq.answer = kind === "gone" ? { kind } : { kind, reason: "HQ answered this read." };
      try {
        await act(async () =>
          root.render(<ZeropsChangeLinkChip href={HREF}>{HREF}</ZeropsChangeLinkChip>),
        );
        expect(container.textContent).toContain(
          kind === "gone" ? "zitdev has no change #31" : "This change could not be read",
        );
        const buttons = buttonsLabelled(container, "Read again");
        expect(buttons).toHaveLength(kind === "refused" ? 0 : 1);
        expect(hq.readAgain).not.toHaveBeenCalled();
        if (kind !== "refused") {
          await act(async () => press(buttons[0]!));
          expect(hq.readAgain).toHaveBeenCalledTimes(1);
        }
      } finally {
        await act(async () => root.unmount());
      }
    },
  );

  it("asks HQ for nothing the flow carries", async () => {
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ZeropsChangeLinkChip } = await import("./ZeropsChangeLinkChip");
    const root = createRoot(document.createElement("div") as unknown as Element);
    shown.value = flowValue(HQ, [LANDED]);
    try {
      await act(async () =>
        root.render(<ZeropsChangeLinkChip href={HREF}>{HREF}</ZeropsChangeLinkChip>),
      );
      expect(hq.asked).toBeNull();
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
    const { ChangeChipMomentContext, ZeropsChangeLinkChip } =
      await import("./ZeropsChangeLinkChip");
    hq.answer = {
      kind: "read",
      pull: { ...LANDED, mergedAt: "2026-09-20T11:00:00.000Z" } as FlowPullRequest,
    };
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    shown.value = flowValue(HQ);
    try {
      await act(async () =>
        root.render(
          <ChangeChipMomentContext value={writtenAt}>
            <ZeropsChangeLinkChip href={HREF}>{HREF}</ZeropsChangeLinkChip>
          </ChangeChipMomentContext>,
        ),
      );
      expect(container.textContent).toBe(`Cache the link previews${tail}`);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
