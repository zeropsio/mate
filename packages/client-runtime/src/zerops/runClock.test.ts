import { describe, expect, it } from "vite-plus/test";

import { formatRunClock } from "./runClock.ts";

describe("formatRunClock — a working Mate's clock beside its name", () => {
  it.each([
    { ms: 0, label: "0s" },
    { ms: 42_000, label: "42s" },
    { ms: 440_000, label: "7m 20s" },
    { ms: 425_000, label: "7m 05s" },
    { ms: 3_599_000, label: "59m 59s" },
    { ms: 3_840_000, label: "1h 04m" },
    { ms: -5_000, label: "0s" },
  ])("reads $ms ms as $label, in units, never like a time of day", ({ ms, label }) => {
    expect(formatRunClock(ms)).toBe(label);
  });
});
