import { describe, expect, it } from "vite-plus/test";

import {
  formatWorkingTime,
  isQuietMate,
  QUIET_AFTER_MS,
  sidebarMateKey,
} from "./SidebarZeropsTree.logic";

describe("formatWorkingTime — how long a Mate has been at it", () => {
  it.each([
    { ms: 0, label: "0:00" },
    { ms: 7_000, label: "0:07" },
    { ms: 192_000, label: "3:12" },
    { ms: 3_599_000, label: "59:59" },
    { ms: 3_840_000, label: "1h 04m" },
    { ms: 37_800_000, label: "10h 30m" },
    // A clock skewed ahead of the server never reads as a negative time.
    { ms: -5_000, label: "0:00" },
  ])("reads $ms ms as $label", ({ ms, label }) => {
    expect(formatWorkingTime(ms)).toBe(label);
  });
});

describe("isQuietMate — a Mate untouched for a week folds away", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const WEEK = QUIET_AFTER_MS;
  it.each([
    {
      case: "resting a week and a minute",
      face: "idle",
      at: ago(WEEK + 60_000),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "resting six days",
      face: "idle",
      at: ago(WEEK - 86_400_000),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "done a fortnight ago, seen since",
      face: "done",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "done a fortnight ago, never looked at",
      face: "done",
      at: ago(2 * WEEK),
      unread: true,
      active: false,
      quiet: false,
    },
    {
      case: "waiting on somebody",
      face: "needs",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "working",
      face: "working",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "paused at a limit",
      face: "sleep",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "the one whose conversation is open",
      face: "idle",
      at: ago(2 * WEEK),
      unread: false,
      active: true,
      quiet: false,
    },
  ] as const)("is quiet: $case → $quiet", ({ face, at, unread, active, quiet }) => {
    expect(isQuietMate({ face, at, unread }, now, active)).toBe(quiet);
  });

  it("never folds a Mate nobody can date", () => {
    expect(isQuietMate(undefined, now, false)).toBe(false);
  });
});

describe("sidebarMateKey — the list's own keys on a Mate's row", () => {
  it.each([
    { key: "j", action: "next" },
    { key: "ArrowDown", action: undefined },
    { key: "k", action: "previous" },
    { key: "x", action: "stop" },
    { key: "X", action: "stop" },
    { key: "e", action: "unread" },
    { key: "E", action: "unread" },
    { key: "q", action: undefined },
  ] as const)("reads $key as $action", ({ key, action }) => {
    expect(sidebarMateKey({ key, modified: false })).toBe(action);
  });

  it("leaves every key with a modifier to whoever bound it", () => {
    expect(sidebarMateKey({ key: "j", modified: true })).toBeUndefined();
  });
});
