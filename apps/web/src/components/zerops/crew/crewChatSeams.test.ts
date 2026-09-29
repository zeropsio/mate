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

const JOB_V2 = seam("job-2", 1, { seam: "saved", apply: "nextTurn" }, "Job updated to v2");
const BRIEF_V5 = seam("brief-5", 2, { seam: "saved", apply: "nextTurn" }, "Brief updated to v5");
const STARTED = seam("stint", 0, { seam: "stint", previousThreadId: null }, "Started fresh");
const FIRST = message("first", 5);
const JOB_V3 = seam("job-3", 9, { seam: "saved", apply: "nextTurn" }, "Job updated to v3");
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
      entries: [JOB_V2, BRIEF_V5],
      fromStart: true,
      drawn: [],
    },
    {
      name: "a save's seam before the first message is not drawn; one after it is history",
      entries: [JOB_V2, FIRST, JOB_V3],
      fromStart: true,
      drawn: ["first", "job-3"],
    },
    {
      name: "why the conversation began, and a landing, always stand",
      entries: [STARTED, JOB_V2, LANDED],
      fromStart: true,
      drawn: ["stint", "landed"],
    },
    {
      name: "with older turns still to load, the first message is not known: every seam stays",
      entries: [JOB_V2, FIRST, JOB_V3],
      fromStart: false,
      drawn: ["job-2", "first", "job-3"],
    },
  ])("$name", ({ entries, fromStart, drawn }) => {
    expect(crewChatEntries(entries, fromStart).map((entry) => entry.id)).toEqual(drawn);
  });

  it("hands back the entries as they were when nothing is hidden", () => {
    const entries = [STARTED, FIRST, JOB_V3];
    expect(crewChatEntries(entries, true)).toBe(entries);
  });
});
