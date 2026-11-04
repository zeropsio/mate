// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  dockAsk,
  showAskInConversation,
  undockAsk,
  useDockedAsk,
  useAskCardOnScreen,
  useAskReveal,
  useReportAskOnScreen,
} from "./askReveal";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ROWS = [
  { kind: "message", id: "m1" },
  { kind: "vault-request", id: "v1" },
  { kind: "message", id: "m2" },
  { kind: "vault-request", id: "v2" },
] as const;

async function mountConversation() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scrolled: number[] = [];
  const container = document.createElement("div");
  container.innerHTML = `
    <section data-ask-density="compact" data-ask-id="q1"><button>Save to vault</button></section>
    <div data-ask-density="full" data-ask-id="q1"><input disabled /><button>Not now</button></div>`;
  document.body.append(container);
  root = createRoot(document.createElement("div"));
  function Conversation() {
    useAskReveal(ROWS, async (index) => {
      scrolled.push(index);
    });
    return null;
  }
  await act(async () => root!.render(<Conversation />));
  return { scrolled, container };
}

describe("Show in conversation", () => {
  it("scrolls to the last row that holds the ask's card and puts focus in the card", async () => {
    const { scrolled, container } = await mountConversation();
    await act(async () =>
      showAskInConversation({ askId: "q1", holds: (row) => row.kind === "vault-request" }),
    );
    expect(scrolled).toEqual([3]);
    expect(document.activeElement).toBe(
      container.querySelector('[data-ask-density="full"] button'),
    );
  });

  it("moves nothing when the conversation holds no row with the card", async () => {
    const { scrolled } = await mountConversation();
    await act(async () => showAskInConversation({ askId: "q1", holds: () => false }));
    expect(scrolled).toEqual([]);
  });
});

describe("the dock stands only while the card is out of view", () => {
  it("a card in view keeps the ask off the composer; scrolled away or not drawn, it docks", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let report: ((entries: Array<{ intersectionRatio: number }>) => void) | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ intersectionRatio: number }>) => void) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const seen: boolean[] = [];
    function Dock() {
      seen.push(useAskCardOnScreen("q1"));
      return null;
    }
    function Card() {
      return <div ref={useReportAskOnScreen("q1")} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <>
          <Dock />
          <Card />
        </>,
      ),
    );
    expect(seen.at(-1)).toBe(true);
    await act(async () => report!([{ intersectionRatio: 0.1 }]));
    expect(seen.at(-1)).toBe(false);
    await act(async () => report!([{ intersectionRatio: 0.9 }]));
    expect(seen.at(-1)).toBe(true);
    await act(async () => root!.render(<Dock />));
    expect(seen.at(-1)).toBe(false);
  });
});

describe("an ask a card offers to dock", () => {
  it("stands above the composer, newest first, until its card takes it back", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const seen: Array<string | null> = [];
    function Composer() {
      seen.push(useDockedAsk("thread-1")?.askId ?? null);
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Composer />));
    expect(seen.at(-1)).toBeNull();
    await act(async () => dockAsk("thread-1", { askId: "mcp-1", render: () => null }));
    await act(async () => dockAsk("thread-1", { askId: "mcp-2", render: () => null }));
    expect(seen.at(-1)).toBe("mcp-2");
    await act(async () => undockAsk("thread-1", "mcp-2"));
    expect(seen.at(-1)).toBe("mcp-1");
    await act(async () => undockAsk("thread-1", "mcp-1"));
    expect(seen.at(-1)).toBeNull();
  });
});
