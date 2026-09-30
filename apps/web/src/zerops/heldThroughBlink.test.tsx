import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import { BLINK_GRACE_MS, shownThroughBlink } from "./heldThroughBlink";

const A = { name: "a" };
const B = { name: "b" };

describe("shownThroughBlink — a source that blinks keeps what it last said", () => {
  it.each([
    {
      case: "the source answers",
      value: B,
      key: "org-1",
      held: { key: "org-1", value: A },
      shown: B,
    },
    {
      case: "it blinks in the same scope: the last answer stands",
      value: undefined,
      key: "org-1",
      held: { key: "org-1", value: A },
      shown: A,
    },
    {
      case: "another scope: never the last one's answer",
      value: undefined,
      key: "org-2",
      held: { key: "org-1", value: A },
      shown: undefined,
    },
    {
      case: "no scope (signed out): nothing",
      value: undefined,
      key: undefined,
      held: { key: "org-1", value: A },
      shown: undefined,
    },
    {
      case: "never answered: nothing",
      value: undefined,
      key: "org-1",
      held: undefined,
      shown: undefined,
    },
  ])("$case", ({ value, key, held, shown }) => {
    expect(shownThroughBlink({ value, key, held })).toBe(shown);
  });
});

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useHeldThroughBlink — a blink is held for its grace, a real absence is not", () => {
  it.each([
    {
      case: "back within the grace: never missing",
      goneMs: BLINK_GRACE_MS - 1_000,
      back: true,
      seen: [A, A, A],
    },
    {
      case: "gone past the grace: let go",
      goneMs: BLINK_GRACE_MS,
      back: false,
      seen: [A, A, undefined],
    },
  ])("$case", async ({ goneMs, back, seen }) => {
    vi.useFakeTimers();
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useHeldThroughBlink } = await import("./heldThroughBlink");
    /** Every value the probe rendered, the latest last. */
    const rendered: Array<typeof A | undefined> = [];
    function Probe(props: { readonly value: typeof A | undefined }) {
      rendered.push(useHeldThroughBlink(props.value, "org-1"));
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    const out: Array<typeof A | undefined> = [];
    try {
      await act(async () => root.render(<Probe value={A} />));
      out.push(rendered.at(-1));
      await act(async () => root.render(<Probe value={undefined} />));
      out.push(rendered.at(-1));
      await act(async () => {
        vi.advanceTimersByTime(goneMs);
      });
      if (back) await act(async () => root.render(<Probe value={A} />));
      out.push(rendered.at(-1));
      expect(out).toEqual(seen);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
