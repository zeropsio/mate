import { describe, expect, it } from "vite-plus/test";

import { finishSetupContainer, mateProjectPastGrace } from "./finishSetup.logic";
import { MATE_CONTAINER_GRACE_MS } from "./mateComing";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("mateProjectPastGrace — a press in another browser has had its time", () => {
  it.each([
    { case: "made a moment ago", created: ago(10_000), want: false },
    { case: "made past the grace", created: ago(MATE_CONTAINER_GRACE_MS + 1), want: true },
    { case: "of no known age", created: undefined, want: false },
  ])("$case: $want", ({ created, want }) => {
    expect(mateProjectPastGrace(created === undefined ? {} : { created }, NOW)).toBe(want);
  });
});

// Finish setup imports a container only where its project has none and no press may still be
// making one: a key is regenerated for it, which would cut a live container off (pass 28 review).
describe("finishSetupContainer — whether Finish setup imports a container", () => {
  it.each([
    {
      case: "a Mate with its container",
      hasService: true,
      pressStopped: true,
      pastGrace: true,
      want: null,
    },
    {
      case: "a Mate past the grace with none",
      hasService: false,
      pressStopped: false,
      pastGrace: true,
      want: { agents: [] },
    },
    {
      case: "a Mate whose press this tab saw stop before its container",
      hasService: false,
      pressStopped: true,
      pastGrace: false,
      want: { agents: [] },
    },
    {
      case: "a Mate made a moment ago, whose press may still be importing it elsewhere",
      hasService: false,
      pressStopped: false,
      pastGrace: false,
      want: null,
    },
  ])("$case", ({ want, ...input }) => {
    expect(finishSetupContainer(input)).toEqual(want);
  });
});
