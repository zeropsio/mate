// @vitest-environment happy-dom
/**
 * The selected band in a document: it stands over the open Mate's unit — its
 * row and, where it has one, its crew's line, one thing in the menu (the
 * owner, 2026-09-29: "why isn't crew included in the hover?") — and never
 * over the changes under it. There is no layout here, so each part says
 * where the browser puts it (`data-box`: its top and height) and a wrapper
 * stands around its children, as a column of blocks does.
 */
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarSelectedBand } from "./SidebarSelectedBand";

const LIST_LEFT = 9;
const LIST_WIDTH = 411;

function box(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: LIST_LEFT,
    right: LIST_LEFT + LIST_WIDTH,
    x: LIST_LEFT,
    y: top,
    width: LIST_WIDTH,
    height,
    toJSON: () => ({}),
  };
}

/** Where the browser would put `element`: its own box, else around its children. */
function laidOut(element: Element): DOMRect {
  const own = element.getAttribute("data-box");
  if (own !== null) {
    const [top = 0, height = 0] = own.split(",").map(Number);
    return box(top, height);
  }
  const children = [...element.children].map(laidOut).filter((rect) => rect.height > 0);
  if (children.length === 0) return box(0, 0);
  const top = Math.min(...children.map((rect) => rect.top));
  return box(top, Math.max(...children.map((rect) => rect.bottom)) - top);
}

/** The list's observers, so a test can say when the list changed size. */
const observers: Array<() => void> = [];

/** Whether the page gets laid out after a draw; a test holds it to see what the draw itself read. */
let layoutDone = true;

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return laidOut(this);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
        observers.push(callback);
      }
      // As the browser does: a target observed anew is reported once, after
      // the page is laid out.
      observe() {
        if (layoutDone) queueMicrotask(this.#callback);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  observers.length = 0;
  layoutDone = true;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A Mate as the menu draws it: its unit — the row, 76 px, and its crew's
 * line 2 px under it, 30 px — then a change row of its own under that.
 */
function Mate({
  id,
  top,
  crew,
}: {
  readonly id: string;
  readonly top: number;
  readonly crew: boolean;
}) {
  return (
    <div>
      <div data-zerops-mate-unit={id}>
        <div data-zerops-mate-row={id}>
          <button data-box={`${String(top)},76`} data-zerops-surface="sidebar-mate" type="button" />
        </div>
        {crew ? (
          <div data-box={`${String(top + 78)},30`} data-zerops-surface="sidebar-crew" />
        ) : null}
      </div>
      <ul>
        <li
          data-box={`${String(top + (crew ? 110 : 78))},28`}
          data-zerops-surface="sidebar-pull-request"
        />
      </ul>
    </div>
  );
}

async function draw(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("nav"));
  host.setAttribute("data-box", "92,1400");
  root = createRoot(host);
  await act(() => root!.render(node));
}

const band = () =>
  document.querySelector<HTMLElement>('[data-zerops-surface="sidebar-selected-band"]')!;

describe("the selected band over the open Mate", () => {
  it("covers its row and its crew's line as one unit, and none of its changes", async () => {
    await draw(
      <>
        <SidebarSelectedBand current="fen" />
        <div data-zerops-surface="sidebar-project-rows">
          <Mate crew id="fen" top={212} />
        </div>
      </>,
    );
    expect(band().hasAttribute("data-on")).toBe(true);
    expect(band().style.transform).toBe("translate(0px, 120px)");
    // 76 px of row, 2 px between, 30 px of crew: the change row stays out.
    expect(band().style.height).toBe("108px");
    expect(band().style.width).toBe("411px");
  });

  it("covers a Mate without a crew exactly as its row, as it always did", async () => {
    await draw(
      <>
        <SidebarSelectedBand current="enzo" />
        <div data-zerops-surface="sidebar-project-rows">
          <Mate crew={false} id="enzo" top={212} />
        </div>
      </>,
    );
    expect(band().style.transform).toBe("translate(0px, 120px)");
    expect(band().style.height).toBe("76px");
  });

  // The crew's feed answers after the menu drew — a reload with nothing
  // remembered: the line arrives in its own draw, and the list grows. The
  // band takes it in at once, where it stands; nothing slides.
  it("takes in a crew's line that arrives after it was placed, at once and without a slide", async () => {
    let arrive: (() => void) | undefined;
    function LateCrew() {
      const [shown, setShown] = useState(false);
      arrive = () => {
        setShown(true);
      };
      return shown ? <div data-box="290,30" data-zerops-surface="sidebar-crew" /> : null;
    }
    await draw(
      <>
        <SidebarSelectedBand current="fen" />
        <div data-zerops-surface="sidebar-project-rows">
          <div data-zerops-mate-unit="fen">
            <div data-zerops-mate-row="fen">
              <button data-box="212,76" data-zerops-surface="sidebar-mate" type="button" />
            </div>
            <LateCrew />
          </div>
        </div>
      </>,
    );
    expect(band().style.height).toBe("76px");
    await act(() => {
      arrive!();
    });
    await act(() => {
      for (const changed of observers) changed();
    });
    expect(band().style.transform).toBe("translate(0px, 120px)");
    expect(band().style.height).toBe("108px");
    expect(band().hasAttribute("data-sliding")).toBe(false);
  });

  it("slides from one Mate's unit to the next one opened, and lands on all of it", async () => {
    function Menu({ open }: { readonly open: string }) {
      return (
        <>
          <SidebarSelectedBand current={open} />
          <div data-zerops-surface="sidebar-project-rows">
            <Mate crew={false} id="enzo" top={212} />
            <Mate crew id="fen" top={400} />
          </div>
        </>
      );
    }
    await draw(<Menu open="enzo" />);
    expect(band().hasAttribute("data-sliding")).toBe(false);
    await act(() => root!.render(<Menu open="fen" />));
    expect(band().hasAttribute("data-sliding")).toBe(true);
    expect(band().style.transform).toBe("translate(0px, 308px)");
    expect(band().style.height).toBe("108px");
  });

  // A click on a menu row draws the whole page: a box read in the draw itself
  // forced the style and layout of every element before the draw was done.
  it("reads no box while a draw is written, and lands once the page is laid out", async () => {
    function Menu({ open }: { readonly open: string }) {
      return (
        <>
          <SidebarSelectedBand current={open} />
          <div data-zerops-surface="sidebar-project-rows">
            <Mate crew={false} id="enzo" top={212} />
            <Mate crew id="fen" top={400} />
          </div>
        </>
      );
    }
    await draw(<Menu open="enzo" />);
    const read = vi.mocked(Element.prototype.getBoundingClientRect);
    read.mockClear();
    layoutDone = false;
    await act(() => root!.render(<Menu open="fen" />));
    expect(read).not.toHaveBeenCalled();
    await act(() => {
      for (const laidOutNow of observers) laidOutNow();
    });
    expect(band().style.transform).toBe("translate(0px, 308px)");
    expect(band().style.height).toBe("108px");
    expect(band().hasAttribute("data-sliding")).toBe(true);
  });
});
