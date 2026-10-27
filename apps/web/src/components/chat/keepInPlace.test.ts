import { describe, expect, it } from "vite-plus/test";

import { keepInPlace, type PlacedElement } from "./keepInPlace";

/** An element whose box the test moves, and the scroll it stands in. */
function stage(top: number, bottom: number) {
  const scroller = { scrollTop: 1000 };
  const box = { top, bottom };
  const element: PlacedElement = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: box.top, bottom: box.bottom }),
  };
  return { scroller, box, element };
}

// Closing what the person opened collapses what stands above the button they
// pressed ("Show less" at an output's foot): the conversation keeps the
// card's top still, so the button jumped up by the whole output. It stays
// under the pointer: the scroll follows it by exactly how far it moved.
describe("keepInPlace", () => {
  it("scrolls by how far the element moved, so it stays where it was", () => {
    const { scroller, box, element } = stage(600, 620);
    keepInPlace({
      anchor: element,
      fallback: null,
      scroller,
      change: () => {
        box.top = 600 - 2400;
        box.bottom = 620 - 2400;
      },
    });
    expect(scroller.scrollTop).toBe(1000 - 2400);
  });

  it("follows the container's foot when the element it pressed is gone", () => {
    const { scroller, element } = stage(600, 620);
    const bubble = stage(200, 640);
    keepInPlace({
      anchor: element,
      fallback: bubble.element,
      scroller,
      change: () => {
        (element as { isConnected: boolean }).isConnected = false;
        bubble.box.bottom = 640 - 300;
      },
    });
    expect(scroller.scrollTop).toBe(1000 - 300);
  });

  it("leaves the scroll alone where nothing moved, or there is no scroll", () => {
    const { scroller, element } = stage(600, 620);
    keepInPlace({ anchor: element, fallback: null, scroller, change: () => {} });
    expect(scroller.scrollTop).toBe(1000);
    expect(() =>
      keepInPlace({ anchor: element, fallback: null, scroller: null, change: () => {} }),
    ).not.toThrow();
  });
});
