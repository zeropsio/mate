import { expect, it } from "@effect/vitest";

import { isWholeWordRange } from "./wholeWordRange.ts";

// A raw match of `text` between `before` and `after` on one line.
const kept = (before: string, text: string, after: string) =>
  isWholeWordRange(before + text + after, {
    start: before.length,
    end: before.length + text.length,
  });

const ASTRAL_LETTER = "\u{1D400}"; // MATHEMATICAL BOLD CAPITAL A, a letter outside the BMP
const ASTRAL_SYMBOL = "\u{1F600}"; // an emoji, not a word character

// witness: apps/server/src/workspace/wholeWordRange.ts | previousCodeUnit >= 0xdc00 && previousCodeUnit <= 0xdfff ? index - 2 : index - 1; → index - 1;
it("WS+1: A whole-word content search keeps a match only when each edge meets the line's end, a non-word character or its own punctuation, astral-plane letters counting as word characters", () => {
  expect({
    alone: kept("", "foo", " bar"),
    inParentheses: kept("(", "foo", ")"),
    wordAfter: kept("", "foo", "bar"),
    wordBefore: kept("bar", "foo", ""),
    underscoreAfter: kept("", "foo", "_x"),
    ownPunctuationEdge: kept("a", ".b", " c"),
    astralLetterBefore: kept(ASTRAL_LETTER, "foo", ""),
    astralLetterAfter: kept("", "foo", ASTRAL_LETTER),
    astralSymbolBefore: kept(ASTRAL_SYMBOL, "foo", ""),
  }).toEqual({
    alone: true,
    inParentheses: true,
    wordAfter: false,
    wordBefore: false,
    underscoreAfter: false,
    ownPunctuationEdge: true,
    astralLetterBefore: false,
    astralLetterAfter: false,
    astralSymbolBefore: true,
  });
});
