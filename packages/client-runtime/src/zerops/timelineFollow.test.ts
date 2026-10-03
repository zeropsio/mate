import { describe, expect, it } from "vite-plus/test";

import {
  nextTimelineFollow,
  personIsScrolling,
  PERSON_SCROLL_SETTLE_MS,
  type TimelineFollowEvent,
} from "./timelineFollow.ts";

describe("nextTimelineFollow", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly following: boolean;
    readonly event: TimelineFollowEvent;
    readonly expected: boolean;
  }> = [
    // The person leaves the end: off at once, whatever the list says.
    { name: "a person scrolls up", following: true, event: { type: "left-end" }, expected: false },
    {
      name: "a person scrolls up again",
      following: false,
      event: { type: "left-end" },
      expected: false,
    },
    // Nothing that arrives moves what a person reads.
    {
      name: "a card below settles shorter and the list lands at its end",
      following: false,
      event: { type: "position", atEnd: true, byPerson: false },
      expected: false,
    },
    {
      name: "a resync redraws the rows with the viewport at the end",
      following: false,
      event: { type: "position", atEnd: true, byPerson: false },
      expected: false,
    },
    {
      name: "a message lands below while the person reads",
      following: false,
      event: { type: "position", atEnd: false, byPerson: false },
      expected: false,
    },
    // Only a person turns it back on.
    {
      name: "the person scrolls back to the end",
      following: false,
      event: { type: "position", atEnd: true, byPerson: true },
      expected: true,
    },
    {
      name: "the person scrolls but stops short of the end",
      following: false,
      event: { type: "position", atEnd: false, byPerson: true },
      expected: false,
    },
    { name: "jump to latest", following: false, event: { type: "jump-to-latest" }, expected: true },
    { name: "the person sends", following: false, event: { type: "sent" }, expected: true },
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
    // While following, growth that leaves the end for a frame keeps following.
    {
      name: "the end grows faster than the follow scroll",
      following: true,
      event: { type: "position", atEnd: false, byPerson: false },
      expected: true,
    },
    {
      name: "a wheel in a nested scroller while the end grows",
      following: true,
      event: { type: "position", atEnd: false, byPerson: true },
      expected: true,
    },
  ];

  it.each(cases)("$name", ({ following, event, expected }) => {
    expect(nextTimelineFollow(following, event)).toBe(expected);
  });
});

describe("personIsScrolling", () => {
  const cases = [
    { name: "no gesture yet", lastGestureAt: null, held: false, now: 5_000, expected: false },
    { name: "a wheel just now", lastGestureAt: 4_900, held: false, now: 5_000, expected: true },
    {
      name: "the last gesture's scroll still settling",
      lastGestureAt: 5_000 - PERSON_SCROLL_SETTLE_MS,
      held: false,
      now: 5_000,
      expected: true,
    },
    {
      name: "a gesture long over",
      lastGestureAt: 5_000 - PERSON_SCROLL_SETTLE_MS - 1,
      held: false,
      now: 5_000,
      expected: false,
    },
    {
      name: "a scrollbar held still",
      lastGestureAt: 1_000,
      held: true,
      now: 9_000,
      expected: true,
    },
  ] as const;

  it.each(cases)("$name", ({ lastGestureAt, held, now, expected }) => {
    expect(personIsScrolling({ lastGestureAt, held, now })).toBe(expected);
  });
});
