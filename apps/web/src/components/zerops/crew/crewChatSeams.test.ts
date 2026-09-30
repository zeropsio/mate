import type { CrewSeam } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../../session-logic";
import { crewChatEntries } from "./crewChatSeams";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 9, minute)).toISOString();

function seam(id: string, minute: number, crewSeam: CrewSeam, label: string): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at(minute),
    entry: { id, createdAt: at(minute), label, tone: "info", crewSeam },
  } as TimelineEntry;
}

function message(id: string, minute: number): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: at(minute),
    message: { id, role: "user", text: "Add seasons to the world.", createdAt: at(minute) },
  } as unknown as TimelineEntry;
}

const JOB_EARLY = seam(
  "job-2",
  1,
  { seam: "saved", apply: "nextTurn" },
  "Its job changed — from its next message",
);
const GOAL_EARLY = seam(
  "brief-5",
  2,
  { seam: "saved", apply: "nextTurn" },
  "The crew's goal changed — from its next message",
);
const STARTED = seam(
  "stint",
  0,
  { seam: "stint", previousThreadId: null },
  "You cleared its conversation",
);
const FIRST = message("first", 5);
const JOB_LATER = seam(
  "job-3",
  9,
  { seam: "saved", apply: "nextTurn" },
  "Its job changed — from its next message",
);
const LANDED = seam(
  "landed",
  3,
  { seam: "landed", taskId: "task-1", number: 1, commit: "a1b2c3d" },
  "Task #1 landed",
);

describe("crewChatEntries", () => {
  it.each<{
    readonly name: string;
    readonly entries: TimelineEntry[];
    readonly fromStart: boolean;
    readonly drawn: ReadonlyArray<string>;
  }>([
    {
      name: "an empty chat opens on its own empty state: no save's seam",
      entries: [JOB_EARLY, GOAL_EARLY],
      fromStart: true,
      drawn: [],
    },
    {
      name: "a save's seam before the first message is not drawn; one after it is history",
      entries: [JOB_EARLY, FIRST, JOB_LATER],
      fromStart: true,
      drawn: ["first", "job-3"],
    },
    {
      name: "why the conversation began, and a landing, always stand",
      entries: [STARTED, JOB_EARLY, LANDED],
      fromStart: true,
      drawn: ["stint", "landed"],
    },
    {
      name: "with older turns still to load, the first message is not known: every seam stays",
      entries: [JOB_EARLY, FIRST, JOB_LATER],
      fromStart: false,
      drawn: ["job-2", "first", "job-3"],
    },
  ])("$name", ({ entries, fromStart, drawn }) => {
    expect(crewChatEntries(entries, fromStart).map((entry) => entry.id)).toEqual(drawn);
  });

  it("hands back the entries as they were when nothing is hidden", () => {
    const entries = [STARTED, FIRST, JOB_LATER];
    expect(crewChatEntries(entries, true)).toBe(entries);
  });
});
