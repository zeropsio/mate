import { describe, expect, it } from "vite-plus/test";

import type { RoleMateVisibility } from "../mateAccess.ts";
import { mateRolesStep, type MateRolesFrame, type MateRolesRead } from "./mateRoles.ts";

/** Each Mate whose verdict moved, frame by frame, in order. */
const changes = (frames: ReadonlyArray<MateRolesFrame>): ReadonlyArray<string> => {
  let last: MateRolesRead | null = null;
  const heard: string[] = [];
  for (const frame of frames) {
    const step = mateRolesStep(last, frame);
    last = step.last;
    heard.push(...step.changed);
  }
  return heard;
};

const frame = (
  orgId: string,
  verdicts: Record<string, RoleMateVisibility | "unknown">,
): MateRolesFrame => ({ orgId, verdicts });

describe("the person's role on each Mate", () => {
  it.each([
    {
      name: "hidden, then its row read again, then open",
      frames: [
        frame("org", { p1: "hidden" }),
        frame("org", { p1: "unknown" }),
        frame("org", { p1: "open" }),
      ],
      heard: ["p1"],
    },
    {
      name: "open, then listed",
      frames: [
        frame("org", { p1: "open", p2: "open" }),
        frame("org", { p1: "listed", p2: "open" }),
      ],
      heard: ["p1"],
    },
  ])("a verdict moving between two readings is heard: $name", ({ frames, heard }) => {
    expect(changes(frames)).toEqual(heard);
  });

  it.each([
    {
      name: "its first reading",
      frames: [frame("org", { p1: "unknown" }), frame("org", { p1: "open" })],
    },
    {
      name: "the same verdict",
      frames: [frame("org", { p1: "open" }), frame("org", { p1: "open" })],
    },
    {
      name: "another organization shown",
      frames: [frame("org", { p1: "listed" }), frame("other", { p1: "open" })],
    },
  ])("a verdict that did not move is never heard: $name", ({ frames }) => {
    expect(changes(frames)).toEqual([]);
  });
});
