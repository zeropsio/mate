// @vitest-environment happy-dom
/**
 * The line's band in a document, as a Mate at work redraws it: a face
 * changing state switches nothing, and most of the line's draws are those.
 * There is no layout here, so each seat says where the browser puts it
 * (`data-left`), and the page's ResizeObserver reports once the test lays
 * the page out.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MATE_SEAT, type LineStage } from "./ConversationStrip.logic";
import { LineMotion } from "./ConversationStripMotion";

let root: Root | undefined;
let layOut: (() => void) | undefined;

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    top: 0,
    bottom: 32,
    x: left,
    y: 0,
    width,
    height: 32,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The frame's callbacks run as they are asked for; layout is the test's to say.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const left = this.getAttribute("data-left");
    return left === null ? rect(0, 0) : rect(Number(left), 80);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        layOut = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  layOut = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const STAGE: LineStage = { band: MATE_SEAT, crew: ["@ivy"] };

function Line({ mateLeft, face }: { readonly mateLeft: number; readonly face: string }) {
  return (
    <div data-left="0">
      <LineMotion stage={STAGE} onFolded={() => undefined} />
      <span data-conversation-mate="" data-face={face} data-left={String(mateLeft)} />
    </div>
  );
}

const band = () => document.querySelector<HTMLElement>(".conversation-band")!;
const firstPiece = () => band().children[0] as HTMLElement;

describe("the line's band through draws that switch nothing", () => {
  it("reads no box in the draw, and follows a reflow once the page is laid out", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(() => root!.render(<Line face="idle" mateLeft={10} />));
    expect(band().hasAttribute("data-on")).toBe(true);
    expect(firstPiece().style.left).toBe("10px");

    const read = vi.mocked(Element.prototype.getBoundingClientRect);
    read.mockClear();
    // A face changes state, and the Mate's pill reflows by 6 px.
    await act(() => root!.render(<Line face="working" mateLeft={16} />));
    expect(read).not.toHaveBeenCalled();
    expect(firstPiece().style.left).toBe("10px");

    await act(() => layOut?.());
    expect(firstPiece().style.left).toBe("16px");
    expect(band().getAnimations()).toHaveLength(0);
  });
});
