import { describe, expect, it } from "vite-plus/test";

import { CHAT_OPENS_WITH, chatOpensAt, EARLIER_CHUNK, earlierShown } from "./runCard.logic";

describe("chatOpensAt", () => {
  it.each([
    { lines: 0, from: 0 },
    { lines: 12, from: 0 },
    { lines: CHAT_OPENS_WITH, from: 0 },
    { lines: CHAT_OPENS_WITH + 1, from: 1 },
    { lines: 900, from: 900 - CHAT_OPENS_WITH },
  ])("a chat of $lines lines opens at line $from", ({ lines, from }) => {
    expect(chatOpensAt(lines)).toBe(from);
  });
});

describe("earlierShown", () => {
  it.each([
    { from: 1, shows: 1, next: 0 },
    { from: 88, shows: 88, next: 0 },
    { from: EARLIER_CHUNK, shows: EARLIER_CHUNK, next: 0 },
    { from: EARLIER_CHUNK + 60, shows: EARLIER_CHUNK, next: 60 },
  ])("from line $from, a click shows $shows and leaves $next", ({ from, shows, next }) => {
    expect(earlierShown(from)).toEqual({ shows, next });
  });

  // D4: nothing is ever out of reach — however long the run, clicking
  // "Show N earlier" until it is gone draws every line, and each click says
  // exactly how many it draws.
  it.each([1, 41, 199, 200, 201, 860, 5000])(
    "reaches every line of a %i-line chat, a click at a time",
    (lines) => {
      let from = chatOpensAt(lines);
      let drawn = lines - from;
      let clicks = 0;
      while (from > 0) {
        const { shows, next } = earlierShown(from);
        expect(shows).toBe(from - next);
        expect(shows).toBeGreaterThan(0);
        drawn += shows;
        from = next;
        clicks += 1;
      }
      expect(drawn).toBe(lines);
      expect(clicks).toBe(Math.ceil(Math.max(0, lines - CHAT_OPENS_WITH) / EARLIER_CHUNK));
    },
  );
});
