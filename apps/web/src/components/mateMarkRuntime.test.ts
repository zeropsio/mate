import type { MateMarkState } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  createMarkLoop,
  markBandTarget,
  type LiveMarkParts,
  type MarkLoopHost,
} from "./mateMarkRuntime";

// Where the band sits for a pose: in asleep and waking, out awake. A waking Mate's slow swell is
// the stylesheet's (`mate-mark-swell`), so the loop has nothing to move while it waits.
describe("markBandTarget", () => {
  it.each([
    { state: "idle", band: 1 },
    { state: "working", band: 1 },
    { state: "needs", band: 1 },
    { state: "sleep", band: 0 },
    { state: "waking", band: 0 },
  ] as const)("$state: $band", ({ state, band }) => {
    expect(markBandTarget(state)).toBe(band);
  });
});

/** A page at 60 Hz whose clock the test steps: frames, timers, and every write to a mark's nodes. */
function fakePage({
  reduced: reducedAtFirst = false,
  height = 33,
  laysOut = false,
}: {
  readonly reduced?: boolean;
  readonly height?: number;
  /** Whether the page offers the loop a turn once it is laid out (`afterLayout`), as a browser's does. */
  readonly laysOut?: boolean;
} = {}) {
  let clock = 0;
  let reduced = reducedAtFirst;
  /** Where the mark's box stands; a test moves it to stand for a layout change. */
  const box = { left: 100, top: 100 };
  let nextHandle = 1;
  const frames = new Map<number, (now: number) => void>();
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  const log = { frames: 0, writes: 0, writesTo: new Map<string, number>(), readsInFrame: 0 };
  /** What waits for the page to be laid out: run after each frame's callbacks. */
  let laidOut: Array<() => void> = [];
  let inFrame = false;

  const host: MarkLoopHost = {
    now: () => clock,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimer: (run, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + Math.max(0, ms), run });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle as number),
    reducedMotion: () => reduced,
    random: () => 0.5,
    viewport: () => ({ width: 1786, height: 1000 }),
    ...(laysOut
      ? {
          afterLayout: (callback: () => void) => {
            laidOut.push(callback);
          },
        }
      : {}),
  };

  const node = (name: string) => {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, () => void>();
    const count = () => {
      log.writes += 1;
      log.writesTo.set(name, (log.writesTo.get(name) ?? 0) + 1);
    };
    let transform = "";
    const properties = new Map<string, string>();
    return {
      properties,
      attributes,
      listeners,
      children: [] as unknown[],
      setAttribute: (key: string, value: string) => {
        count();
        attributes.set(key, value);
      },
      removeAttribute: (key: string) => {
        count();
        attributes.delete(key);
      },
      getAttribute: (key: string) => attributes.get(key) ?? null,
      style: {
        get transform() {
          return transform;
        },
        set transform(value: string) {
          count();
          transform = value;
        },
        setProperty: (key: string, value: string) => {
          count();
          properties.set(key, value);
        },
        removeProperty: (key: string) => {
          count();
          properties.delete(key);
        },
      },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      getBoundingClientRect: () => {
        if (inFrame) log.readsInFrame += 1;
        return { left: box.left, top: box.top, width: height * 0.85, height };
      },
    };
  };

  const mount = (forced?: MateMarkState, options: { readonly awake?: boolean } = {}) => {
    const svg = node("svg");
    const sides = node("sides");
    sides.children = Array.from({ length: 12 }, (_, index) => node(`side${index}`));
    const parts = {
      svg,
      bob: node("bob"),
      sides,
      band: node("band"),
      bandLeft: node("bandLeft"),
      bandRight: node("bandRight"),
      eyes: node("eyes"),
      eyeLeft: node("eyeLeft"),
      eyeRight: node("eyeRight"),
      happyLeft: node("happyLeft"),
      happyRight: node("happyRight"),
      mouth: node("mouth"),
      mouthO: node("mouthO"),
      mouthSmile: node("mouthSmile"),
    };
    const unregister = loop.register(
      svg as unknown as SVGSVGElement,
      parts as unknown as LiveMarkParts,
      forced,
      options,
    );
    return { svg, parts, unregister };
  };

  /** Steps the clock frame by frame, firing what is due; returns the frames and writes it saw. */
  const advance = (ms: number) => {
    const before = { frames: log.frames, writes: log.writes };
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + 16);
      for (const [handle, timer] of timers) {
        if (timer.at > clock) continue;
        timers.delete(handle);
        timer.run();
      }
      const due = [...frames.values()];
      frames.clear();
      inFrame = true;
      for (const run of due) {
        log.frames += 1;
        run(clock);
      }
      inFrame = false;
      const waiting = laidOut;
      laidOut = [];
      for (const run of waiting) run();
    }
    return { frames: log.frames - before.frames, writes: log.writes - before.writes };
  };

  const loop = createMarkLoop(host);
  return {
    loop,
    mount,
    advance,
    log,
    box,
    setReduced: (value: boolean) => {
      reduced = value;
    },
    pending: () => ({ frames: frames.size, timers: timers.size }),
  };
}

describe("the live mark's loop", () => {
  it("runs no frame while an awake mark rests, between its blinks", () => {
    const page = fakePage();
    page.mount(undefined, { awake: true });
    page.advance(200);
    // Settled, waiting on what is scheduled: one timer, no frame. Its glance about (at 1.2 s, back
    // to the centre it already looks at) takes one frame and writes nothing.
    expect(page.pending()).toEqual({ frames: 0, timers: 1 });
    const resting = page.advance(2_700);
    expect(resting.writes).toBe(0);
    expect(resting.frames).toBeLessThanOrEqual(1);
  });

  it("moves through a blink frame by frame, then stops until the next one", () => {
    const page = fakePage();
    page.mount(undefined, { awake: true });
    page.advance(2_900);
    const blink = page.advance(700);
    expect(blink.frames).toBeGreaterThan(10);
    expect(blink.frames).toBeLessThan(45);
    expect(page.pending().frames).toBe(0);
    const after = page.advance(2_000);
    expect(after.writes).toBe(0);
    expect(after.frames).toBeLessThanOrEqual(1);
  });

  it("follows a pointer move with frames until the eyes and the turn settle, then stops", () => {
    const page = fakePage();
    page.mount(undefined, { awake: true });
    page.advance(100);
    page.loop.pointerMove(900, 500);
    const following = page.advance(1_900);
    expect(following.frames).toBeGreaterThan(30);
    expect(page.advance(500)).toEqual({ frames: 0, writes: 0 });
  });

  it("falls asleep after 45 s without the pointer, then holds still with nothing scheduled", () => {
    const page = fakePage();
    const { parts } = page.mount(undefined, { awake: true });
    page.advance(47_000);
    expect(parts.band.attributes.get("visibility")).toBe("visible");
    expect(page.pending()).toEqual({ frames: 0, timers: 0 });
    expect(page.advance(30_000)).toEqual({ frames: 0, writes: 0 });
    // A pointer wakes it again.
    page.loop.pointerMove(10, 10);
    expect(page.advance(1_000).frames).toBeGreaterThan(10);
  });

  it.each([
    { forced: "waking" },
    { forced: "sleep" },
    { forced: "working" },
    { forced: "needs" },
  ] as const)("a mark held $forced settles and runs no frame per frame", ({ forced }) => {
    const page = fakePage();
    page.mount(forced);
    page.advance(2_000);
    expect(page.pending().frames).toBe(0);
    expect(page.advance(800).frames).toBeLessThanOrEqual(1);
  });

  it("ticks nothing while off screen, and takes its pose once when it comes back", () => {
    const page = fakePage();
    const { svg, parts } = page.mount(undefined, { awake: true });
    page.advance(100);
    page.loop.setVisible(svg as unknown as Element, false);
    page.loop.pointerMove(900, 500);
    expect(page.advance(50_000).writes).toBe(0);
    page.loop.setVisible(svg as unknown as Element, true);
    page.advance(1_500);
    // Asleep by now: it comes back shut, without ticking its way there while hidden.
    expect(parts.band.attributes.get("visibility")).toBe("visible");
    expect(page.pending().frames).toBe(0);
  });

  it("writes only what changed: a blink touches the eyes, not the side wall or the band", () => {
    const page = fakePage();
    page.mount(undefined, { awake: true });
    page.advance(2_900);
    const before = new Map(page.log.writesTo);
    page.advance(700);
    const wrote = (name: string) => (page.log.writesTo.get(name) ?? 0) - (before.get(name) ?? 0);
    expect(wrote("eyeLeft")).toBeGreaterThan(0);
    expect(wrote("side0") + wrote("sides") + wrote("bandLeft") + wrote("band")).toBe(0);
  });

  // A bob of 0.3 of 52 units moves a menu-size mark by a fifth of a pixel: nobody sees it, and it
  // would repaint the mark every frame. Only a mark 48 px tall or more bobs.
  it.each([
    { name: "hero size, awake and idle", height: 64, reduced: false, wait: 200, bob: "on" },
    { name: "48 px, awake and idle", height: 48, reduced: false, wait: 200, bob: "on" },
    { name: "hero size, asleep", height: 64, reduced: false, wait: 47_000, bob: "off" },
    { name: "hero size, reduced motion", height: 64, reduced: true, wait: 200, bob: "off" },
    { name: "47 px, awake and idle", height: 47, reduced: false, wait: 200, bob: undefined },
    { name: "menu size, awake and idle", height: 33, reduced: false, wait: 200, bob: undefined },
    { name: "menu size, asleep", height: 33, reduced: false, wait: 47_000, bob: undefined },
  ])("bobs by the stylesheet only while idle, awake and large: $name", (row) => {
    const page = fakePage({ reduced: row.reduced, height: row.height });
    const { svg } = page.mount(undefined, { awake: true });
    page.advance(row.wait);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe(row.bob);
    expect(svg.attributes.has("data-mate-mark-bob")).toBe(row.bob !== undefined);
  });

  it("turns the bob off when a mark leaves view, and on again when it comes back", () => {
    const page = fakePage({ height: 80 });
    const { svg } = page.mount(undefined, { awake: true });
    page.advance(200);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe("on");
    page.loop.setVisible(svg as unknown as Element, false);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe("off");
    page.loop.setVisible(svg as unknown as Element, true);
    page.advance(100);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe("on");
  });

  it.each([
    { name: "read in the frame", laysOut: false },
    { name: "read once laid out", laysOut: true },
  ])(
    "keeps measuring for a moment after a press, so a layout it shifts is caught ($name)",
    ({ laysOut }) => {
      const page = fakePage({ laysOut });
      const { parts } = page.mount(undefined, { awake: true });
      page.loop.pointerMove(900, 140);
      page.advance(2_000);
      const aimed = parts.eyeLeft.attributes.get("x");
      // The press toggles a panel: the mark's box moves a frame or two later, the pointer stays.
      page.loop.pointerDown(900, 140);
      page.advance(32);
      page.box.left = 700;
      page.advance(2_000);
      expect(parts.eyeLeft.attributes.get("x")).not.toBe(aimed);
      expect(page.pending().frames).toBe(0);
    },
  );

  // A frame comes before the page's last draw is laid out: a box read there forces that layout.
  it("reads a mark's box only once the page is laid out, and poses it from there", () => {
    const page = fakePage({ laysOut: true });
    const { parts } = page.mount(undefined, { awake: true });
    page.loop.pointerMove(900, 140);
    page.advance(2_000);
    const aimed = parts.eyeLeft.attributes.get("x");
    expect(aimed).toBeDefined();
    page.loop.pointerDown(900, 140);
    page.box.left = 700;
    page.advance(2_000);
    expect(parts.eyeLeft.attributes.get("x")).not.toBe(aimed);
    expect(page.log.readsInFrame).toBe(0);
    expect(page.pending().frames).toBe(0);
  });

  it.each([
    { name: "turned on while asleep: it opens, still", from: false, to: true, timers: 0 },
    { name: "turned off: it blinks and glances again", from: true, to: false, timers: 1 },
  ])("notices reduced motion changing: $name", ({ from, to, timers }) => {
    const page = fakePage({ reduced: from });
    const { parts } = page.mount(undefined, { awake: true });
    page.advance(47_000);
    page.setReduced(to);
    page.loop.motionChanged();
    page.advance(1_000);
    expect(parts.band.attributes.get("visibility")).toBe("hidden");
    expect(page.pending()).toEqual({ frames: 0, timers });
  });

  it("clears what it wrote on the mark's root when the mark leaves the loop", () => {
    const page = fakePage({ height: 80 });
    const { svg, unregister } = page.mount(undefined, { awake: true });
    page.loop.pointerMove(900, 500);
    page.advance(2_000);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe("on");
    expect(svg.properties.has("--mate-mark-bob-delay")).toBe(true);
    expect(svg.style.transform).not.toBe("");
    unregister();
    expect(svg.attributes.has("data-mate-mark-bob")).toBe(false);
    expect(svg.properties.has("--mate-mark-bob-delay")).toBe(false);
    expect(svg.style.transform).toBe("");
  });

  it.each([{ forced: "needs" }, { forced: "done" }, { forced: "working" }] as const)(
    "a page of marks held $forced still falls asleep: its eyes stop following",
    ({ forced }) => {
      const page = fakePage();
      const { parts } = page.mount(forced);
      // Where its eyes stand: the happy arcs when done, the open eyes otherwise.
      const look = () =>
        forced === "done"
          ? parts.happyLeft.attributes.get("transform")
          : parts.eyeLeft.attributes.get("x");
      page.advance(1_000);
      const ahead = look();
      page.loop.pointerMove(1_500, 900);
      page.advance(2_000);
      expect(look()).not.toBe(ahead);
      page.advance(46_000);
      expect(look()).toBe(ahead);
    },
  );

  it("stops everything when the last mark goes", () => {
    const page = fakePage();
    const { unregister } = page.mount(undefined, { awake: true });
    page.advance(100);
    unregister();
    expect(page.pending()).toEqual({ frames: 0, timers: 0 });
  });
});
