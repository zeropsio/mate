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
function fakePage({ reduced = false }: { readonly reduced?: boolean } = {}) {
  let clock = 0;
  let nextHandle = 1;
  const frames = new Map<number, (now: number) => void>();
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  const log = { frames: 0, writes: 0, writesTo: new Map<string, number>() };

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
  };

  const node = (name: string) => {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, () => void>();
    const count = () => {
      log.writes += 1;
      log.writesTo.set(name, (log.writesTo.get(name) ?? 0) + 1);
    };
    let transform = "";
    return {
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
        setProperty: (_key: string, _value: string) => count(),
      },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 28, height: 33 }),
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
      for (const run of due) {
        log.frames += 1;
        run(clock);
      }
    }
    return { frames: log.frames - before.frames, writes: log.writes - before.writes };
  };

  const loop = createMarkLoop(host);
  return {
    loop,
    mount,
    advance,
    log,
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

  it.each([
    { name: "awake and idle", reduced: false, wait: 200, bob: "on" },
    { name: "asleep", reduced: false, wait: 47_000, bob: "off" },
    { name: "reduced motion", reduced: true, wait: 200, bob: "off" },
  ])("bobs by the stylesheet only while idle and awake: $name", ({ reduced, wait, bob }) => {
    const page = fakePage({ reduced });
    const { svg } = page.mount(undefined, { awake: true });
    page.advance(wait);
    expect(svg.attributes.get("data-mate-mark-bob")).toBe(bob);
  });

  it("stops everything when the last mark goes", () => {
    const page = fakePage();
    const { unregister } = page.mount(undefined, { awake: true });
    page.advance(100);
    unregister();
    expect(page.pending()).toEqual({ frames: 0, timers: 0 });
  });
});
