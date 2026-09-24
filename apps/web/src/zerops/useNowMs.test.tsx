import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
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

describe("useSecondsNowMs", () => {
  it.each([
    { active: true, advancedMs: 3_000 },
    { active: false, advancedMs: 0 },
  ])(
    "active=$active: the clock a surface renders moves $advancedMs ms over 3 s",
    async ({ active, advancedMs }) => {
      vi.useFakeTimers({ now: Date.parse("2026-09-24T10:00:00.000Z") });
      const document = installTestDom();
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { useSecondsNowMs } = await import("./useNowMs");
      const rendered: Array<number> = [];

      function Clock() {
        rendered.push(useSecondsNowMs(active));
        return null;
      }

      const root = createRoot(document.createElement("div") as unknown as Element);
      try {
        await act(async () => root.render(<Clock />));
        const first = rendered.at(-1)!;
        await act(async () => vi.advanceTimersByTime(3_000));
        expect(rendered.at(-1)! - first).toBe(advancedMs);
      } finally {
        await act(async () => root.unmount());
      }
    },
  );
});
