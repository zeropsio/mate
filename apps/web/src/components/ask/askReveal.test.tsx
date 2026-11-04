// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { showAskInConversation, useAskReveal } from "./askReveal";

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
