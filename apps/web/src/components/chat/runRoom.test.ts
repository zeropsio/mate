// @vitest-environment happy-dom
/**
 * A run's card whose boxes ease, in a document with no layout: each box says
 * how tall the browser lays it out (`data-h`), and the test counts what was
 * read. A card nobody sees — its conversation's list kept out of sight —
 * reads nothing as its words stream, and shows what it holds at once when
 * it comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { easeRooms, type Rooms } from "./runRoom";

let rooms: Rooms | undefined;
let resized: (entries: ResizeObserverEntry[]) => void;
let frame: FrameRequestCallback;
let observing: Set<Element>;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        resized = callback;
        observing = new Set();
      }
      observe(element: Element) {
        observing.add(element);
      }
      unobserve(element: Element) {
        observing.delete(element);
      }
      disconnect() {
        observing.clear();
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const height = Number(this.getAttribute("data-h") ?? 0);
    return {
      top: 0,
      left: 0,
      right: 100,
      bottom: height,
      x: 0,
      y: 0,
      width: 100,
      height,
    } as DOMRect;
  });
});

afterEach(() => {
  rooms?.stop();
  rooms = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A card in a conversation's list, kept out of sight or not, with one bubble streaming. */
function card({
  kept,
  eases = () => true,
}: {
  readonly kept: boolean;
  readonly eases?: () => boolean;
}) {
  const list = document.body.appendChild(document.createElement("div"));
  if (kept) list.setAttribute("data-kept-timeline", "");
  const root = list.appendChild(document.createElement("div"));
  root.setAttribute("data-run-chat", "");
  root.setAttribute("data-h", "100");
  const bubble = root.appendChild(document.createElement("div"));
  bubble.setAttribute("data-chat-bubble", "");
  bubble.setAttribute("data-h", "20");
  const content = bubble.appendChild(document.createElement("div"));
  content.textContent = "Reading";
  rooms = easeRooms({ root, selector: "[data-chat-bubble]", eases });
  /** Its words grow, and the bubble with them. */
  const grow = (words: string, height: number) => {
    bubble.setAttribute("data-h", String(height));
    root.setAttribute("data-h", String(80 + height));
    content.textContent = words;
    rooms!.flush();
  };
  return { list, root, bubble, content, grow };
}

const reads = () => vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;

describe("a run card's rooms", () => {
  it("intrinsic image growth releases a shrinking box before decoded pixels can be clipped", () => {
    const { root, bubble, content, grow } = card({ kept: false });
    bubble.style.overflow = "hidden";
    grow("An image is loading", 10);
    expect(observing.has(content)).toBe(true);
    // Decoding changes layout without changing words, classes or child nodes.
    bubble.setAttribute("data-h", "140");
    root.setAttribute("data-h", "220");
    resized([{ target: content } as unknown as ResizeObserverEntry]);
    expect(bubble.style.height).toBe("");
    expect(bubble.style.clipPath).toBe("");
    expect(bubble.style.overflow).toBe("hidden");
  });

  it("stopping motion while a box eases releases its held height on the next frame", () => {
    let easing = true;
    const { bubble, grow } = card({ kept: false, eases: () => easing });
    grow("Reading the logs", 10);
    expect(bubble.style.height).toBe("20px");
    easing = false;
    frame(16);
    expect(bubble.style.height).toBe("");
    expect(bubble.style.clipPath).toBe("");
  });

  it("in sight, growing words take their full height immediately", () => {
    const { bubble, grow } = card({ kept: false });
    grow("Reading the logs", 60);
    expect(bubble.style.height).toBe("");
  });

  it("kept out of sight, its words streaming read no box and hold no height", () => {
    const { bubble, grow } = card({ kept: true });
    const before = reads();
    grow("Reading the logs", 60);
    grow("Reading the logs of", 90);
    expect(reads()).toBe(before);
    expect(bubble.style.height).toBe("");
  });

  it("shown again, what came while away is simply there; what comes after eases", () => {
    const { list, bubble, grow } = card({ kept: true });
    grow("Reading the logs", 60);
    list.removeAttribute("data-kept-timeline");
    grow("Reading the logs of", 90);
    expect(bubble.style.height).toBe("");
    grow("Reading the logs of the app", 60);
    expect(bubble.style.height).toBe("90px");
  });
});
