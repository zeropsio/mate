import { describe, expect, it } from "vite-plus/test";

import {
  USAGE_RESUME_GRACE_MS,
  isHeldBackgroundResult,
  liftsUsagePause,
  pauseForBlock,
  resumesAtReset,
  resumeDelayMs,
} from "./usagePause.ts";

const NOW = "2026-09-26T09:00:00.000Z";
const LATER = "2026-09-26T13:00:00.000Z";
const LATEST = "2026-09-30T00:00:00.000Z";
const current = {
  resetsAt: LATER,
  window: "5-hour",
  held: 2,
  pausedAt: "2026-09-26T08:30:00.000Z",
};

describe("pauseForBlock", () => {
  it.each([
    {
      name: "a first block pauses from now",
      current: null,
      block: { window: "5-hour", resetsAt: LATER },
      expected: { resetsAt: LATER, window: "5-hour", held: 0, pausedAt: NOW },
    },
    {
      name: "the same block again changes nothing",
      current,
      block: { window: "5-hour", resetsAt: LATER },
      expected: undefined,
    },
    {
      name: "a window closing later extends the same pause",
      current,
      block: { window: "7-day", resetsAt: LATEST },
      expected: { ...current, resetsAt: LATEST, window: "7-day" },
    },
    {
      name: "a window reopening sooner does not shorten it",
      current: { ...current, resetsAt: LATEST, window: "7-day" },
      block: { window: "5-hour", resetsAt: LATER },
      expected: undefined,
    },
    {
      name: "a block whose reset has passed pauses nothing",
      current: null,
      block: { window: "5-hour", resetsAt: "2026-09-26T08:59:59.000Z" },
      expected: undefined,
    },
  ])("$name", ({ current: pause, block, expected }) => {
    expect(pauseForBlock({ current: pause, block, now: NOW })).toEqual(expected);
  });
});

describe("resumeDelayMs", () => {
  it.each([
    { name: "hours ahead", now: NOW, expected: 4 * 60 * 60 * 1000 + USAGE_RESUME_GRACE_MS },
    { name: "at the reset", now: LATER, expected: USAGE_RESUME_GRACE_MS },
    { name: "long past it (a restart during the pause)", now: LATEST, expected: 0 },
  ])("waits for the reset and its grace: $name", ({ now, expected }) => {
    expect(resumeDelayMs({ resetsAt: LATER }, Date.parse(now))).toBe(expected);
  });
});

describe("resumesAtReset", () => {
  it.each([
    { status: null, autoResume: true, expected: true },
    { status: "error", autoResume: true, expected: true },
    { status: "ready", autoResume: true, expected: true },
    { status: "stopped", autoResume: true, expected: true },
    { status: "interrupted", autoResume: true, expected: true },
    { status: "running", autoResume: true, expected: false },
    { status: "starting", autoResume: true, expected: false },
    { status: "error", autoResume: false, expected: false },
  ] as const)(
    "a $status session with auto-resume $autoResume resumes: $expected",
    ({ status, autoResume, expected }) => {
      expect(resumesAtReset({ autoResume, sessionStatus: status })).toBe(expected);
    },
  );
});

const runtimeEvent = (event: Record<string, unknown>) =>
  ({
    eventId: "event-1",
    provider: "claudeAgent",
    threadId: "thread-1",
    createdAt: NOW,
    ...event,
  }) as unknown as Parameters<typeof isHeldBackgroundResult>[0];

describe("isHeldBackgroundResult", () => {
  it.each([
    { name: "a background result", turnId: undefined, status: "completed", expected: true },
    { name: "a background failure", turnId: undefined, status: "failed", expected: true },
    {
      name: "a task stopped with its session",
      turnId: undefined,
      status: "stopped",
      expected: false,
    },
    { name: "a result inside a turn", turnId: "turn-1", status: "completed", expected: false },
  ])("$name: $expected", ({ turnId, status, expected }) => {
    expect(
      isHeldBackgroundResult(
        runtimeEvent({
          type: "task.completed",
          ...(turnId ? { turnId } : {}),
          payload: { taskId: "task-1", status },
        }),
      ),
    ).toBe(expected);
  });
});

describe("liftsUsagePause", () => {
  it.each([
    { state: "completed", expected: true },
    { state: "failed", expected: false },
    { state: "interrupted", expected: false },
    { state: "cancelled", expected: false },
  ])("a turn that ends $state lifts the pause: $expected", ({ state, expected }) => {
    expect(
      liftsUsagePause(
        runtimeEvent({ type: "turn.completed", turnId: "turn-1", payload: { state } }),
      ),
    ).toBe(expected);
  });
});
