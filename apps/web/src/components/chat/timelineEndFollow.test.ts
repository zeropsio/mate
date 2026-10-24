import {
  classifyTimelineScroll,
  jumpedAway,
  nextTimelineFollow,
} from "@t3tools/client-runtime/zerops/timelineFollow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createEndFollow,
  GLIDE_FROM_PX,
  GLIDING_ATTRIBUTE,
  ownListScrolls,
  scrollOwn,
  takeOwnScroll,
} from "./timelineEndFollow";

const FRAME_MS = 1000 / 60;

/**
 * A list's scroll as the browser keeps it — its top clamped to its range, one
 * scroll event after the moves of a frame — and whether the conversation
 * follows its end, as ChatView decides it (`nextTimelineFollow`): a person's
 * move up away from the end turns it off, a person's move back onto the end
 * band turns it on again. The follower reads only that.
 */
function list({ top, height, client }: { top: number; height: number; client: number }) {
  let scrollTop = top;
  const attributes = new Set<string>();
  const element = {
    scrollHeight: height,
    clientHeight: client,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(next: number) {
      scrollTop = Math.max(0, Math.min(next, element.scrollHeight - element.clientHeight));
    },
    toggleAttribute: (name: string, on: boolean) => {
      if (on) attributes.add(name);
      else attributes.delete(name);
    },
    hasAttribute: (name: string) => attributes.has(name),
  };
  const state = { follows: true };
  return {
    element,
    state,
    /** A person scrolls to `to`; ChatView judges follow from where it lands (its 40 px band). */
    person: (to: number) => {
      const from = scrollTop;
      element.scrollTop = to;
      const fromEnd = element.scrollHeight - element.clientHeight - scrollTop;
      if (scrollTop < from && fromEnd > 0) state.follows = false;
      if (scrollTop > from && fromEnd <= 40) state.follows = true;
    },
  };
}

describe("createEndFollow", () => {
  let frames: Array<(now: number) => void> = [];
  let now = 0;
  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the frames due, `gap` ms apart, and says where it stood after each. */
  const play = (scroll: ReturnType<typeof list>, gap = FRAME_MS) => {
    const tops: number[] = [];
    for (let guard = 0; frames.length > 0 && guard < 200; guard += 1) {
      now += gap;
      for (const frame of frames.splice(0)) frame(now);
      tops.push(scroll.element.scrollTop);
    }
    return tops;
  };

  /** A list standing at its end, 1000 tall in a 400 viewport, followed as ChatView says. */
  const atItsEnd = (client = 400) => {
    const scroll = list({ top: 1000 - client, height: 1000, client });
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    follow.follow();
    return { scroll, follow };
  };

  const endOf = (scroll: ReturnType<typeof list>) =>
    scroll.element.scrollHeight - scroll.element.clientHeight;

  const grow = (scroll: ReturnType<typeof list>, follow: { follow: () => void }, by: number) => {
    scroll.element.scrollHeight += by;
    follow.follow();
  };

  it.each([48, 96, 217])(
    "a live row growing by %i px keeps its end in sight in the frame it arrives",
    (grew) => {
      const { scroll, follow } = atItsEnd();
      scroll.element.scrollHeight += grew;
      follow.follow(grew);
      expect(
        endOf(scroll) - scroll.element.scrollTop,
        "ASSERTION: streamed growth stays at the conversation's end before paint",
      ).toBe(0);
      expect(scroll.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(false);
    },
  );

  it("live row growth carries an arriving row's glide without adding to its remaining way", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 300);
    scroll.element.scrollHeight += 96;
    follow.follow(96);
    expect(
      endOf(scroll) - scroll.element.scrollTop,
      "ASSERTION: the glide has only the arriving row left to travel",
    ).toBe(300);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("a browser layout correction during row measurement does not release end-follow", () => {
    const scroll = list({ top: 2944, height: 3779, client: 835 });
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    follow.follow();
    const previous = { scrollTop: 2944, contentHeight: 3779 };
    // Growth starts a glide; another measurement shrinks the native range
    // before it grows again. The browser delivers their scroll event together.
    grow(scroll, follow, 100);
    const beforeClamp = scroll.element.scrollTop;
    scroll.element.scrollHeight = 3611;
    scroll.element.scrollTop = beforeClamp;
    follow.follow();
    scroll.element.scrollHeight = 4009;
    const current = { scrollTop: scroll.element.scrollTop, contentHeight: 4009 };
    const own = takeOwnScroll(scroll.element as unknown as HTMLElement);
    scroll.state.follows = nextTimelineFollow(true, {
      type: "position",
      atEnd: false,
      ...classifyTimelineScroll({ previous, current, personScrolling: false }),
      jumped: !own && jumpedAway({ previous, current }),
    });
    expect(scroll.state.follows).toBe(true);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(3174);
  });

  it("a fractional browser clamp during row measurement keeps the conversation at its end", () => {
    for (const fractionalGap of [0.5, 0.75, 1]) {
      const scroll = list({ top: 2944, height: 3779, client: 835 });
      const follow = createEndFollow({
        placeEnd: vi.fn(),
        viewport: () => scroll.element as unknown as HTMLElement,
        follows: () => scroll.state.follows,
      });
      follow.follow();
      const previous = { scrollTop: 2944, contentHeight: 3779 };
      grow(scroll, follow, 100);
      // Scroll dimensions round to integers; the native clamp need not.
      scroll.element.scrollHeight = 3611;
      scroll.element.scrollTop = 2776 - fractionalGap;
      follow.observe();
      scroll.element.scrollHeight = 4009;
      const current = { scrollTop: scroll.element.scrollTop, contentHeight: 4009 };
      const own = takeOwnScroll(scroll.element as unknown as HTMLElement);
      scroll.state.follows = nextTimelineFollow(true, {
        type: "position",
        atEnd: false,
        ...classifyTimelineScroll({ previous, current, personScrolling: false }),
        jumped: !own && jumpedAway({ previous, current }),
      });
      expect(scroll.state.follows).toBe(true);
      play(scroll);
      expect(scroll.element.scrollTop).toBe(3174);
    }
  });

  it("focus navigation into growing history stays where the reader landed", () => {
    const scroll = list({ top: 4500, height: 6000, client: 835 });
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    follow.follow();
    const previous = { scrollTop: 4500, contentHeight: 6000 };
    scroll.element.scrollHeight = 6200;
    // Focus/find moves without a wheel or key scroll session.
    scroll.element.scrollTop = 1000;
    follow.follow();
    const current = { scrollTop: scroll.element.scrollTop, contentHeight: 6200 };
    const own = takeOwnScroll(scroll.element as unknown as HTMLElement);
    scroll.state.follows = nextTimelineFollow(true, {
      type: "position",
      atEnd: false,
      ...classifyTimelineScroll({ previous, current, personScrolling: false }),
      jumped: !own && jumpedAway({ previous, current }),
    });
    expect(scroll.state.follows).toBe(false);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(1000);
  });

  it.each([
    { what: "a row easing taller by a few pixels", grew: 6, glides: false },
    { what: "growth just under a glide's step", grew: GLIDE_FROM_PX - 1, glides: false },
    { what: "a row arriving whole", grew: 155, glides: true },
    { what: "a settled turn's long answer", grew: 992, glides: true },
  ])("follows $what: glides $glides", ({ grew, glides }) => {
    const { scroll, follow } = atItsEnd();
    const from = scroll.element.scrollTop;
    grow(scroll, follow, grew);
    if (!glides) {
      expect(scroll.element.scrollTop).toBe(endOf(scroll));
      return;
    }
    // Nothing moves in the frame it grew; then it glides, no frame 40 px.
    expect(scroll.element.scrollTop).toBe(from);
    const tops = play(scroll);
    expect(tops.at(-1)).toBe(endOf(scroll));
    let last = from;
    for (const top of tops) {
      expect(top - last).toBeLessThan(40);
      expect(top).toBeGreaterThanOrEqual(last);
      last = top;
    }
  });

  // The review, 2026-10-04: one step taller than the list and the composer
  // turned the list's own reading stale after the glide's first frame, and
  // the glide stopped 973 px short, for good.
  it.each([
    { what: "a phone", client: 700, step: 1000 },
    { what: "a desktop", client: 935, step: 2300 },
  ])("glides all the way through a step taller than the list on $what", ({ client, step }) => {
    const { scroll, follow } = atItsEnd(client);
    grow(scroll, follow, step);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
    grow(scroll, follow, 300);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  // Re-review F1: the person came back to the very top the glide had left the
  // list at; the page's record of that top made their return the page's, and
  // the next growth left them 300 px short with follow on.
  it("follows on after the person scrolls up and back to the top the glide left", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 400);
    play(scroll);
    const stood = scroll.element.scrollTop;
    scroll.person(stood - 300);
    expect(scroll.state.follows).toBe(false);
    scroll.person(stood);
    expect(scroll.state.follows).toBe(true);
    grow(scroll, follow, 300);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  // Re-review F2: follow came back on inside ChatView's end band, short of
  // the hard bottom; the follower's own, stricter reading never re-armed.
  it("follows on once follow resumes inside the end band, short of the bottom", () => {
    const scroll = list({ top: 1480, height: 1900, client: 400 });
    scroll.state.follows = false;
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    follow.follow();
    scroll.person(1480 - 200);
    scroll.person(1480);
    expect(scroll.state.follows).toBe(true);
    grow(scroll, follow, 300);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("settles when reaching the end changes a picture's height", () => {
    let top = 600;
    let resized = false;
    const element = {
      scrollHeight: 1000,
      clientHeight: 400,
      get scrollTop() {
        return top;
      },
      set scrollTop(next: number) {
        top = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
        if (!resized && top === this.scrollHeight - this.clientHeight) {
          resized = true;
          this.scrollHeight += 155;
          // The list reports the newly laid-out row after the scroll frame.
          frames.push(() => follow.follow());
        }
      },
    };
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => element as unknown as HTMLElement,
      follows: () => true,
    });
    element.scrollHeight += 300;
    follow.follow();
    for (let guard = 0; frames.length > 0 && guard < 200; guard += 1) {
      now += FRAME_MS;
      for (const frame of frames.splice(0)) frame(now);
    }
    expect(resized).toBe(true);
    expect(element.scrollTop).toBe(element.scrollHeight - element.clientHeight);
    expect(frames).toHaveLength(0);
    follow.follow();
    expect(frames).toHaveLength(0);
  });

  // Milo's stress run 4 (D1): the composer shrank back as a sent message glided in, and the list
  // stood at its new end at once, a 77 px step in one frame.
  it("a composer that changes height mid-glide moves the end the glide goes to, never a jump", () => {
    const scroll = list({ top: 600, height: 1000, client: 400 });
    const follow = createEndFollow({
      placeEnd: () => {
        scroll.element.scrollTop = endOf(scroll);
      },
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    grow(scroll, follow, 176);
    const tops = [scroll.element.scrollTop];
    for (const _ of [1, 2]) {
      now += FRAME_MS;
      for (const frame of frames.splice(0)) frame(now);
      tops.push(scroll.element.scrollTop);
    }
    scroll.element.scrollHeight -= 72;
    follow.place();
    tops.push(scroll.element.scrollTop, ...play(scroll));
    const steps = tops.slice(1).map((top, index) => Math.abs(top - tops[index]!));
    expect(Math.max(...steps)).toBeLessThan(GLIDE_FROM_PX);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  // Milo's stress run 6 (U1): a six-line draft's message arrived and the composer shrank back
  // before any glide began, and the list stood at its new end at once, 223 px in one frame.
  it("a tall message arriving as the composer shrinks glides to the end, never a jump", () => {
    const scroll = list({ top: 600, height: 1000, client: 400 });
    const follow = createEndFollow({
      placeEnd: () => {
        scroll.element.scrollTop = endOf(scroll);
      },
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    scroll.element.scrollHeight += 283 - 67;
    follow.place(-67);
    const tops = [600, scroll.element.scrollTop, ...play(scroll)];
    const steps = tops.slice(1).map((top, index) => Math.abs(top - tops[index]!));
    expect(Math.max(...steps)).toBeLessThan(GLIDE_FROM_PX);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("a composer growing keeps its line in place at once, and what arrived with it glides", () => {
    const scroll = list({ top: 600, height: 1000, client: 400 });
    const follow = createEndFollow({
      placeEnd: () => {
        scroll.element.scrollTop = endOf(scroll);
      },
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    scroll.element.scrollHeight += 120 + 200;
    follow.place(120);
    expect(scroll.element.scrollTop).toBe(720);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("a composer that changes height with nothing gliding keeps the end in place at once", () => {
    const placeEnd = vi.fn();
    const scroll = list({ top: 600, height: 1000, client: 400 });
    const follow = createEndFollow({
      placeEnd,
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    scroll.element.scrollHeight += 40;
    follow.place(40);
    expect(placeEnd).toHaveBeenCalledTimes(1);
  });

  // Run 5 (C +0:15.29): an answer held where its words were read stands a few pixels short of the
  // end its foot leaves under it; a glide there moved the line the person was reading.
  it("keeps a place short of the end as the end until the end grows, then follows on", () => {
    const { scroll, follow } = atItsEnd();
    scroll.element.scrollHeight += 24;
    follow.keep();
    follow.follow();
    expect(play(scroll), "ASSERTION: nothing glides to the kept place's foot").toEqual([]);
    expect(scroll.element.scrollTop).toBe(600);
    grow(scroll, follow, 300);
    play(scroll);
    expect(scroll.element.scrollTop, "ASSERTION: a new row past it is followed").toBe(
      endOf(scroll),
    );
  });

  // The usage limit holding a message: the composer's inset grew while an answer was held, and
  // keeping the view where it stood held the end 202 px away for good.
  it("keeps no place far short of the end: what moved the view there is followed on to the end", () => {
    const { scroll, follow } = atItsEnd();
    scroll.element.scrollHeight += 202;
    follow.keep();
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("lets a kept place go as the composer's inset moves the end", () => {
    const placeEnd = vi.fn();
    const scroll = list({ top: 600, height: 1000, client: 400 });
    const follow = createEndFollow({
      placeEnd,
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
    });
    scroll.element.scrollHeight += 20;
    follow.keep();
    follow.place();
    expect(placeEnd, "ASSERTION: the end is placed anew, the kept place let go").toHaveBeenCalled();
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("stops where the person scrolled up mid-glide, and stays", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 600);
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    scroll.person(scroll.element.scrollTop - 120);
    const stood = scroll.element.scrollTop;
    play(scroll);
    expect(scroll.element.scrollTop).toBe(stood);
    grow(scroll, follow, 100);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(stood);
  });

  // Rosa on a phone, 2026-10-04: the composer grew under a pause notice, the
  // view shrank and the list moved up 28 px as it re-anchored — nobody's
  // move — and the end was left 230 px under the composer.
  it("follows on through a move up nobody made", () => {
    const { scroll, follow } = atItsEnd();
    scroll.element.clientHeight -= 82;
    scroll.element.scrollHeight += 120;
    scroll.element.scrollTop -= 28;
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("stands back at its end at once, before the frame paints, when the list itself scrolled far up", () => {
    const { scroll, follow } = atItsEnd();
    scroll.element.scrollTop = 120;
    follow.undo();
    expect(
      endOf(scroll) - scroll.element.scrollTop,
      "ASSERTION: the list's own scroll up is undone in the frame it came",
    ).toBe(0);
    expect(frames).toHaveLength(0);
    expect(scroll.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(false);
  });

  it("lets a glide go on from where the list's own scroll put it", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 600);
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    scroll.element.scrollTop -= 74;
    const stood = scroll.element.scrollTop;
    follow.undo();
    expect(scroll.element.scrollTop).toBe(stood);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("never undoes a list scroll it does not follow", () => {
    const { scroll, follow } = atItsEnd();
    scroll.state.follows = false;
    scroll.element.scrollTop = 120;
    follow.undo();
    expect(scroll.element.scrollTop).toBe(120);
  });

  it("stands at the end at once when its next frame comes long after, as on a tab coming back", () => {
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", page);
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 900);
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    now += 2000;
    for (const frame of frames.splice(0)) frame(now);
    expect(frames, "ASSERTION: a returned tab has no unfinished glide").toHaveLength(0);
    expect(scroll.element.scrollTop, "ASSERTION: a returned tab already stands at its end").toBe(
      endOf(scroll),
    );
  });

  it.each([250, 500, 2000])("a visible conversation keeps gliding through %s ms frames", (gap) => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    const { scroll, follow } = atItsEnd();
    const start = scroll.element.scrollTop;
    grow(scroll, follow, 600);
    const tops = play(scroll, gap);
    expect(tops.at(-1), "ASSERTION: the visible conversation reaches its end").toBe(endOf(scroll));
    expect(
      Math.max(...tops.map((top, index) => top - (tops[index - 1] ?? start))),
      "ASSERTION: no visible late frame moves the conversation over its speed cap",
    ).toBeLessThanOrEqual(32);
  });

  it("stands at the end at once while the tab is out of sight", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const { scroll, follow } = atItsEnd();
    grow(scroll, follow, 900);
    expect(frames).toHaveLength(0);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
  });

  it("stands at the end at once while its conversation is not shown yet, and glides once it is", () => {
    const scroll = list({ top: 600, height: 1000, client: 400 });
    let shown = false;
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => scroll.state.follows,
      unseen: () => !shown,
    });
    follow.follow();
    grow(scroll, follow, 253);
    expect(frames).toHaveLength(0);
    expect(scroll.element.scrollTop).toBe(endOf(scroll));
    shown = true;
    grow(scroll, follow, 253);
    expect(scroll.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(true);
  });

  it("never moves a list that does not follow", () => {
    const { scroll, follow } = atItsEnd();
    scroll.state.follows = false;
    grow(scroll, follow, 200);
    play(scroll);
    expect(scroll.element.scrollTop).toBe(600);
  });

  // The scenarios' still-frame probe reads the list's geometry, and the browser hands back a
  // rounded top: a glide's last stretch is sub-pixel a frame, so six frames can read alike while
  // the view is still 2 px off its end. Only the mark says it is still on its way.
  it.each([2, 4])(
    "a glide whose rounded top reads alike for six frames still says it glides while the view is more than 1 px from its end (%i ms frames)",
    (gap) => {
      const { scroll, follow } = atItsEnd();
      // The browser hands back a whole-pixel top; the follower's own `at` stays fractional.
      let exact = scroll.element.scrollTop;
      Object.defineProperty(scroll.element, "scrollTop", {
        get: () => Math.round(exact),
        set: (next: number) => {
          exact = Math.max(
            0,
            Math.min(next, scroll.element.scrollHeight - scroll.element.clientHeight),
          );
        },
      });
      scroll.element.scrollHeight += 300;
      follow.follow();
      const reads: Array<{ top: number; away: number; gliding: boolean }> = [];
      for (let guard = 0; frames.length > 0 && guard < 600; guard += 1) {
        now += gap;
        for (const frame of frames.splice(0)) frame(now);
        reads.push({
          top: Math.round(scroll.element.scrollTop),
          away: endOf(scroll) - exact,
          gliding: scroll.element.hasAttribute(GLIDING_ATTRIBUTE),
        });
      }
      let alike = 0;
      let stalled = 0;
      reads.forEach((read, index) => {
        alike = index > 0 && read.top === reads[index - 1]!.top ? alike + 1 : 0;
        if (alike < 5 || read.away <= 1) return;
        stalled += 1;
        expect(read.gliding, "ASSERTION: a view still on its way says so").toBe(true);
      });
      expect(stalled, "ASSERTION: the probe saw the stall it guards").toBeGreaterThan(0);
      expect(scroll.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(false);
    },
  );

  // Re-review F5: a kept list shown or hidden swaps the list the follower
  // reads; stopping, the old follower must clear what it said on its own list.
  it("clears its gliding mark on the list it glided, though another list took its place", () => {
    const first = list({ top: 600, height: 1000, client: 400 });
    const second = list({ top: 0, height: 500, client: 400 });
    let current = first;
    const follow = createEndFollow({
      placeEnd: vi.fn(),
      viewport: () => current.element as unknown as HTMLElement,
      follows: () => true,
    });
    first.element.scrollHeight += 500;
    follow.follow();
    expect(first.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(true);
    current = second;
    follow.stop();
    expect(first.element.hasAttribute(GLIDING_ATTRIBUTE)).toBe(false);
  });
});

// Re-review F1: the page's own top, once heard, is no longer the page's.
describe("takeOwnScroll", () => {
  it("names the page's move once, and a later scroll to the same top the person's", () => {
    const element = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
    scrollOwn(element as unknown as HTMLElement, 900);
    expect(takeOwnScroll(element as unknown as HTMLElement)).toBe("page");
    element.scrollTop = 600;
    element.scrollTop = 900;
    expect(takeOwnScroll(element as unknown as HTMLElement)).toBeUndefined();
  });
});

describe("ownListScrolls", () => {
  it("tells each scroll the list makes itself as the page's own, once, and the person's after it as theirs", () => {
    const element = {
      scrollTop: 0,
      scrollTo(options: ScrollToOptions) {
        this.scrollTop = options.top ?? this.scrollTop;
      },
      scrollBy(options: ScrollToOptions) {
        this.scrollTop += options.top ?? 0;
      },
    };
    const list = element as unknown as HTMLElement;
    const undo = ownListScrolls(list);
    list.scrollTo({ top: 1764 });
    expect(takeOwnScroll(list)).toBe("list");
    expect(takeOwnScroll(list)).toBeUndefined();
    list.scrollBy({ top: 74 });
    expect(takeOwnScroll(list)).toBe("list");
    element.scrollTop = 400;
    expect(takeOwnScroll(list)).toBeUndefined();
    undo();
    list.scrollTo({ top: 10 });
    expect(takeOwnScroll(list)).toBeUndefined();
  });
});
