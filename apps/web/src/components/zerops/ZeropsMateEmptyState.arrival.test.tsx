// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MateEmptyStateView } from "./ZeropsMateEmptyState";

const KEEP_OPEN = "Keep this tab open for about half a minute: after that it needs nobody.";

let root: Root | undefined;
let host: HTMLElement;

function land(focusOnArrival: boolean) {
  act(() => {
    root = createRoot(host);
    root.render(
      <MateEmptyStateView
        coming={{ kind: "coming", sentence: KEEP_OPEN, below: null }}
        focusOnArrival={focusOnArrival}
        mate={{ name: "Ida", tint: "rose", shape: "seal", project: "Acme CRM", connected: false }}
        onRetry={() => undefined}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />,
    );
  });
}

const headline = () => host.querySelector("h1");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// Run 6's review: the dialog gone, the focus went back to what opened it, and a second Enter
// opened the dialog again over the new page; nothing was said on landing.
describe("a Mate's view landed on from a press", () => {
  it("takes the focus on its headline, which reads with the sentence under it", () => {
    land(true);
    expect(document.activeElement).toBe(headline());
    const described = headline()?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toBe(KEEP_OPEN);
  });

  it("says the sentence politely as it changes", () => {
    land(false);
    const said = document.getElementById(headline()?.getAttribute("aria-describedby") ?? "");
    expect(said?.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it.each([
    { case: "not landed on from a press", focusOnArrival: false, elsewhere: false },
    { case: "the person already elsewhere", focusOnArrival: true, elsewhere: true },
  ])("leaves the focus alone: $case", ({ focusOnArrival, elsewhere }) => {
    const field = document.createElement("input");
    document.body.append(field);
    if (elsewhere) field.focus();
    land(focusOnArrival);
    expect(document.activeElement).not.toBe(headline());
    field.remove();
  });
});
