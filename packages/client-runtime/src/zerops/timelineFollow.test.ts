import { describe, expect, it } from "vite-plus/test";

import {
  classifyTimelineScroll,
  jumpedAway,
  nextPersonScrollSession,
  nextTimelineFollow,
  nextTimelineReading,
  PERSON_SCROLL_IDLE,
  PERSON_SCROLL_QUIET_MS,
  personIsScrolling,
  type PersonScrollSession,
  type PersonScrollSessionEvent,
  type TimelineFollowEvent,
} from "./timelineFollow.ts";

describe("nextTimelineFollow", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly following: boolean;
    readonly event: TimelineFollowEvent;
    readonly expected: boolean;
  }> = [
    // A person's input away from the end: off at once, whatever the list says.
    { name: "a person wheels up", following: true, event: { type: "left-end" }, expected: false },
    // Nothing that arrives moves what a person reads.
    {
      name: "a card below settles shorter and the list clamps to its end",
      following: false,
      event: { type: "position", atEnd: true, byPerson: false, direction: "away" },
      expected: false,
    },
    {
      name: "a row lands below while the person reads",
      following: false,
      event: { type: "position", atEnd: false, byPerson: false, direction: null },
      expected: false,
    },
    // Back on only by a person's scroll that moved toward the end and reached it.
    {
      name: "the person scrolls back down to the end",
      following: false,
      event: { type: "position", atEnd: true, byPerson: true, direction: "toward-end" },
      expected: true,
    },
    {
      name: "the person scrolls down but stops short of the end",
      following: false,
      event: { type: "position", atEnd: false, byPerson: true, direction: "toward-end" },
      expected: false,
    },
    {
      name: "a smooth step up whose first frame is still within the end band",
      following: false,
      event: { type: "position", atEnd: true, byPerson: true, direction: "away" },
      expected: false,
    },
    // While following, the person's scroll that leaves the end turns it off.
    {
      name: "a flick's glide carries the list up off the end",
      following: true,
      event: { type: "position", atEnd: false, byPerson: true, direction: "away" },
      expected: false,
    },
    {
      name: "a scroll up that is still within the end band",
      following: true,
      event: { type: "position", atEnd: true, byPerson: true, direction: "away" },
      expected: true,
    },
    {
      name: "the end grows faster than the follow scroll",
      following: true,
      event: { type: "position", atEnd: false, byPerson: false, direction: "toward-end" },
      expected: true,
    },
    {
      name: "content shrinks under a follower and the browser clamps the list up",
      following: true,
      event: { type: "position", atEnd: false, byPerson: false, direction: "away" },
      expected: true,
    },
    { name: "jump to latest", following: false, event: { type: "jump-to-latest" }, expected: true },
    {
      name: "the person sends",
      following: false,
      event: { type: "sent", byPerson: true },
      expected: true,
    },
    {
      name: "a queued message leaves while the person reads above",
      following: false,
      event: { type: "sent", byPerson: false },
      expected: false,
    },
    {
      name: "a queued message leaves while the person follows",
      following: true,
      event: { type: "sent", byPerson: false },
      expected: true,
    },
    // A person's wheel or key down aimed at the list, in the end band: they
    // are coming back, even where the list cannot move (the hard bottom).
    {
      name: "a person wheels down in the end band",
      following: false,
      event: { type: "toward-end-input", inEndBand: true },
      expected: true,
    },
    {
      name: "a person wheels down far above the end",
      following: false,
      event: { type: "toward-end-input", inEndBand: false },
      expected: false,
    },
    {
      name: "a person wheels down while following",
      following: true,
      event: { type: "toward-end-input", inEndBand: false },
      expected: true,
    },
    {
      name: "a thread opens at its end",
      following: false,
      event: { type: "opened", atEnd: true },
      expected: true,
    },
    {
      name: "a thread left mid-read opens where it was",
      following: true,
      event: { type: "opened", atEnd: false },
      expected: false,
    },
    // The review, 2026-10-04: something far up took the list there with no
    // input of the person's — find in page, a fragment link, focus moving to
    // an earlier control, middle-click autoscroll — and the growth after
    // pulled them back to the end.
    {
      name: "a jump far up that nobody's scroll made, while following",
      following: true,
      event: { type: "position", atEnd: false, byPerson: false, direction: "away", jumped: true },
      expected: false,
    },
    {
      name: "a jump that lands within the end band keeps following",
      following: true,
      event: { type: "position", atEnd: true, byPerson: false, direction: "away", jumped: true },
      expected: true,
    },
    {
      name: "the list re-anchoring a few pixels up keeps following",
      following: true,
      event: { type: "position", atEnd: false, byPerson: false, direction: "away", jumped: false },
      expected: true,
    },
  ];

  it.each(cases)("$name", ({ following, event, expected }) => {
    expect(nextTimelineFollow(following, event)).toBe(expected);
  });
});

describe("classifyTimelineScroll", () => {
  const cases = [
    {
      name: "a person's scroll up",
      previous: { scrollTop: 900, contentHeight: 2_000 },
      current: { scrollTop: 870, contentHeight: 2_000 },
      personScrolling: true,
      expected: { byPerson: true, direction: "away" },
    },
    {
      name: "a person's scroll down",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 700, contentHeight: 2_000 },
      personScrolling: true,
      expected: { byPerson: true, direction: "toward-end" },
    },
    {
      name: "the browser clamps after content shrank, mid-gesture",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 800, contentHeight: 1_800 },
      personScrolling: true,
      expected: { byPerson: false, direction: "away" },
    },
    {
      name: "the list pins its grown end, mid-gesture",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 1_120, contentHeight: 2_120 },
      personScrolling: true,
      expected: { byPerson: false, direction: "toward-end" },
    },
    {
      name: "a person's scroll up while a row lands below",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 960, contentHeight: 2_080 },
      personScrolling: true,
      expected: { byPerson: true, direction: "away" },
    },
    {
      name: "a person's scroll down outruns the stream growing below",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 1_060, contentHeight: 2_020 },
      personScrolling: true,
      expected: { byPerson: true, direction: "toward-end" },
    },
    {
      name: "a person's scroll up outruns content shrinking",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 700, contentHeight: 1_900 },
      personScrolling: true,
      expected: { byPerson: true, direction: "away" },
    },
    {
      name: "the list pins its grown end within a pixel of the growth",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 1_040.6, contentHeight: 2_040 },
      personScrolling: true,
      expected: { byPerson: false, direction: "toward-end" },
    },
    {
      name: "a scroll with no person behind it",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 1_000, contentHeight: 2_000 },
      personScrolling: false,
      expected: { byPerson: false, direction: "toward-end" },
    },
    {
      name: "rows changed and the list did not move",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 600, contentHeight: 2_300 },
      personScrolling: true,
      expected: { byPerson: false, direction: null },
    },
    {
      name: "the first read",
      previous: null,
      current: { scrollTop: 600, contentHeight: 2_000 },
      personScrolling: true,
      expected: { byPerson: false, direction: null },
    },
  ] as const;

  it.each(cases)("$name", ({ previous, current, personScrolling, expected }) => {
    expect(classifyTimelineScroll({ previous, current, personScrolling })).toEqual(expected);
  });
});

describe("jumpedAway", () => {
  it("find-in-page or focus navigation during row measurement releases end-follow", () => {
    const previous = { scrollTop: 4500, contentHeight: 6000 };
    for (const contentHeight of [6200, 5800]) {
      const current = { scrollTop: 1000, contentHeight };
      expect(
        nextTimelineFollow(true, {
          type: "position",
          atEnd: false,
          ...classifyTimelineScroll({ previous, current, personScrolling: false }),
          jumped: jumpedAway({ previous, current }),
        }),
      ).toBe(false);
    }
  });

  it("manual history navigation during row measurement still releases end-follow", () => {
    const previous = { scrollTop: 2944, contentHeight: 3779 };
    const current = { scrollTop: 2776, contentHeight: 4009 };
    expect(
      nextTimelineFollow(true, {
        type: "position",
        atEnd: false,
        ...classifyTimelineScroll({ previous, current, personScrolling: true }),
        jumped: jumpedAway({ previous, current }),
      }),
    ).toBe(false);
  });

  it.each([
    {
      name: "find in page jumps to a match far above",
      previous: { scrollTop: 4_500, contentHeight: 6_000 },
      current: { scrollTop: 1_000, contentHeight: 6_000 },
      jumped: true,
    },
    {
      name: "the list re-anchors 28 px up as the view shrinks",
      previous: { scrollTop: 7_288, contentHeight: 8_080 },
      current: { scrollTop: 7_260, contentHeight: 8_200 },
      jumped: false,
    },
    {
      name: "the browser clamps 300 px up as content below shrinks",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 700, contentHeight: 1_700 },
      jumped: false,
    },
    {
      name: "a move down",
      previous: { scrollTop: 1_000, contentHeight: 2_000 },
      current: { scrollTop: 1_500, contentHeight: 2_000 },
      jumped: false,
    },
  ])("$name: $jumped", ({ previous, current, jumped }) => {
    expect(jumpedAway({ previous, current })).toBe(jumped);
  });
});

describe("nextTimelineReading", () => {
  const cases = [
    {
      name: "the first read is kept",
      previous: null,
      current: { scrollTop: 600, contentHeight: 2_000 },
      expected: { scrollTop: 600, contentHeight: 2_000 },
    },
    {
      name: "a sub-pixel creep keeps the reading it started from",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 599.7, contentHeight: 2_000 },
      expected: { scrollTop: 600, contentHeight: 2_000 },
    },
    {
      name: "a move that registers replaces it",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 599.4, contentHeight: 2_000 },
      expected: { scrollTop: 599.4, contentHeight: 2_000 },
    },
    {
      name: "content that changed replaces it",
      previous: { scrollTop: 600, contentHeight: 2_000 },
      current: { scrollTop: 600.2, contentHeight: 2_080 },
      expected: { scrollTop: 600.2, contentHeight: 2_080 },
    },
  ] as const;

  it.each(cases)("$name", ({ previous, current, expected }) => {
    expect(nextTimelineReading(previous, current)).toEqual(expected);
  });

  it("adds a slow creep up until it registers as a move", () => {
    let reading = nextTimelineReading(null, { scrollTop: 600, contentHeight: 2_000 });
    const directions = [599.8, 599.6, 599.4].map((scrollTop) => {
      const current = { scrollTop, contentHeight: 2_000 };
      const scroll = classifyTimelineScroll({ previous: reading, current, personScrolling: true });
      reading = nextTimelineReading(reading, current);
      return scroll.direction;
    });
    expect(directions).toEqual([null, null, "away"]);
  });
});

describe("person scroll session", () => {
  const run = (events: ReadonlyArray<PersonScrollSessionEvent>): PersonScrollSession =>
    events.reduce(nextPersonScrollSession, PERSON_SCROLL_IDLE);
  const quiet = PERSON_SCROLL_QUIET_MS;
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly events: ReadonlyArray<PersonScrollSessionEvent>;
    readonly now: number;
    readonly expected: boolean;
  }> = [
    { name: "no input yet", events: [], now: 5_000, expected: false },
    {
      name: "a wheel just now",
      events: [{ type: "input", at: 4_950 }],
      now: 5_000,
      expected: true,
    },
    {
      name: "a wheel long ago, the list since moved by rows",
      events: [{ type: "input", at: 1_000 }],
      now: 5_000,
      expected: false,
    },
    {
      name: "a key's smooth scroll carries on frame by frame",
      events: [
        { type: "input", at: 1_000 },
        { type: "scrolled", at: 1_100, byPerson: true },
        { type: "scrolled", at: 1_200, byPerson: true },
      ],
      now: 1_200 + quiet,
      expected: true,
    },
    {
      name: "a flick glides on long after the finger lifts",
      events: [
        { type: "hold", by: "touch", at: 1_000 },
        { type: "release", by: "pointer", at: 1_050 },
        { type: "release", by: "touch", at: 1_100 },
        ...Array.from({ length: 30 }, (_, index) => ({
          type: "scrolled" as const,
          at: 1_116 + index * 16,
          byPerson: true,
        })),
      ],
      now: 1_116 + 29 * 16 + 16,
      expected: true,
    },
    {
      name: "a touch still down after the browser takes the pan",
      events: [
        { type: "hold", by: "touch", at: 1_000 },
        { type: "release", by: "pointer", at: 1_010 },
      ],
      now: 9_000,
      expected: true,
    },
    {
      name: "a code-made scroll does not keep the session going",
      events: [
        { type: "input", at: 1_000 },
        { type: "scrolled", at: 1_100, byPerson: false },
      ],
      now: 1_100 + quiet,
      expected: false,
    },
    {
      name: "the scroll ended",
      events: [
        { type: "input", at: 1_000 },
        { type: "scrolled", at: 1_016, byPerson: true },
        { type: "scroll-ended" },
      ],
      now: 1_020,
      expected: false,
    },
    {
      name: "a scrollbar held still",
      events: [{ type: "hold", by: "pointer", at: 1_000 }],
      now: 9_000,
      expected: true,
    },
    {
      name: "a scrollbar let go a while ago",
      events: [
        { type: "hold", by: "pointer", at: 1_000 },
        { type: "release", by: "pointer", at: 2_000 },
      ],
      now: 2_000 + quiet + 1,
      expected: false,
    },
  ];

  it.each(cases)("$name", ({ events, now, expected }) => {
    expect(personIsScrolling(run(events), now)).toBe(expected);
  });
});
