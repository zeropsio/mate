import { describe, expect, it } from "vite-plus/test";

import {
  clusterFaces,
  groupHoldsCurrent,
  groupLead,
  groupMateOrder,
  groupRowPress,
  heldOrder,
  projectRowKey,
  projectRowKind,
  type LeadReading,
} from "./SidebarProjectRow.logic";

describe("projectRowKind — what a project is in the menu", () => {
  it.each([
    { mates: 0, kind: "bare" },
    { mates: 1, kind: "solo" },
    { mates: 2, kind: "group" },
    { mates: 20, kind: "group" },
  ] as const)("a project with $mates Mates is a $kind row", ({ mates, kind }) => {
    expect(projectRowKind({ mates })).toBe(kind);
  });
});

describe("groupMateOrder — the viewer's Mates first, then colleagues', each in the order made", () => {
  it("never orders by activity: yours by creation, then the rest by creation", () => {
    const order = groupMateOrder([
      { projectId: "c1", mine: false, createdAt: "2026-01-01T00:00:00Z", name: "Corin" },
      { projectId: "m2", mine: true, createdAt: "2026-03-01T00:00:00Z", name: "Mara" },
      { projectId: "c0", mine: false, createdAt: "2025-12-01T00:00:00Z", name: "Brin" },
      { projectId: "m1", mine: true, createdAt: "2026-02-01T00:00:00Z", name: "Tess" },
    ]);
    expect(order.map((mate) => mate.projectId)).toEqual(["m1", "m2", "c0", "c1"]);
  });

  it("puts a Mate made at an unknown time after the dated ones, by name", () => {
    const order = groupMateOrder([
      { projectId: "u2", mine: true, createdAt: undefined, name: "Zed" },
      { projectId: "d1", mine: true, createdAt: "2026-02-01T00:00:00Z", name: "Yan" },
      { projectId: "u1", mine: true, createdAt: undefined, name: "Abe" },
    ]);
    expect(order.map((mate) => mate.projectId)).toEqual(["d1", "u1", "u2"]);
  });
});

describe("heldOrder — rows hold their places while the pointer is over the list", () => {
  it.each([
    {
      case: "not held, the list takes its new order",
      drawn: ["a", "b", "c"],
      next: ["c", "a", "b"],
      held: false,
      shown: ["c", "a", "b"],
    },
    {
      case: "held, a re-ranked row keeps its place",
      drawn: ["a", "b", "c"],
      next: ["c", "a", "b"],
      held: true,
      shown: ["a", "b", "c"],
    },
    {
      case: "held, a removed row leaves and the rest keep their places",
      drawn: ["a", "b", "c"],
      next: ["c", "a"],
      held: true,
      shown: ["a", "c"],
    },
    {
      case: "held, an added row comes in after the row it follows in the new order",
      drawn: ["a", "b", "c"],
      next: ["c", "a", "d", "b"],
      held: true,
      shown: ["a", "d", "b", "c"],
    },
    {
      case: "held, an added row the new order leads with comes in first",
      drawn: ["a", "b"],
      next: ["d", "b", "a"],
      held: true,
      shown: ["d", "a", "b"],
    },
    {
      case: "held, nothing drawn before: the new order",
      drawn: [],
      next: ["b", "a"],
      held: true,
      shown: ["b", "a"],
    },
  ])("$case", ({ drawn, next, held, shown }) => {
    expect(heldOrder(drawn, next, held)).toEqual(shown);
  });

  it("hands back the new order itself where nothing is held back", () => {
    const next = ["a", "b"];
    expect(heldOrder(["a", "b"], next, true)).toBe(next);
  });
});

describe("groupLead — whose face leads a group and whose words its line says", () => {
  const reading = (projectId: string, over: Partial<LeadReading> = {}): LeadReading => ({
    projectId,
    asksViewer: false,
    working: false,
    runSince: undefined,
    at: undefined,
    ...over,
  });

  it.each([
    {
      case: "an ask the viewer can answer leads over work and over newer words",
      readings: [
        reading("a", {
          working: true,
          runSince: "2026-10-12T10:05:00Z",
          at: "2026-10-12T10:05:00Z",
        }),
        reading("b", { asksViewer: true, at: "2026-10-12T09:00:00Z" }),
        reading("c", { at: "2026-10-12T10:06:00Z" }),
      ],
      lead: "b",
      asks: ["b"],
    },
    {
      case: "of two asks, the oldest leads and the other waits behind it",
      readings: [
        reading("a", { asksViewer: true, at: "2026-10-12T10:00:00Z" }),
        reading("b", { asksViewer: true, at: "2026-10-12T09:30:00Z" }),
      ],
      lead: "b",
      asks: ["b", "a"],
    },
    {
      case: "with no ask, the Mate whose run started last leads, however often the others step",
      readings: [
        reading("a", {
          working: true,
          runSince: "2026-10-12T10:00:00Z",
          at: "2026-10-12T10:09:59Z",
        }),
        reading("b", {
          working: true,
          runSince: "2026-10-12T10:04:00Z",
          at: "2026-10-12T10:04:00Z",
        }),
      ],
      lead: "b",
      asks: [],
    },
    {
      case: "with nobody at work, the newest words lead",
      readings: [
        reading("a", { at: "2026-10-12T08:00:00Z" }),
        reading("b", { at: "2026-10-12T09:00:00Z" }),
      ],
      lead: "b",
      asks: [],
    },
    {
      case: "with nothing said by anyone, the first in the group's order leads",
      readings: [reading("a"), reading("b")],
      lead: "a",
      asks: [],
    },
  ])("$case", ({ readings, lead, asks }) => {
    expect(groupLead(readings)).toEqual({ lead, asks });
  });

  it.each([
    {
      case: "an automated Mate waiting for a task never leads over a person's Mate's newer words",
      readings: [
        reading("mira", { at: "2026-10-17T08:00:00Z" }),
        reading("raya", { at: "2026-10-17T18:00:00Z", waitsForTask: true }),
      ],
      lead: "mira",
    },
    {
      case: "an automated Mate at work on its task leads as any Mate at work",
      readings: [
        reading("mira", { at: "2026-10-17T18:00:00Z" }),
        reading("raya", { working: true, runSince: "2026-10-17T17:00:00Z" }),
      ],
      lead: "raya",
    },
    {
      case: "where every Mate waits for a task, the newest words lead",
      readings: [
        reading("ines", { at: "2026-10-17T08:00:00Z", waitsForTask: true }),
        reading("raya", { at: "2026-10-17T18:00:00Z", waitsForTask: true }),
      ],
      lead: "raya",
    },
  ])("$case", ({ readings, lead }) => {
    expect(groupLead(readings).lead).toBe(lead);
  });

  it("leads with nobody in an empty group", () => {
    expect(groupLead([])).toEqual({ lead: undefined, asks: [] });
  });
});

describe("clusterFaces — the group's faces in its avatar", () => {
  it.each([
    { order: ["a", "b"], lead: "b", shown: ["b", "a"], more: 0 },
    { order: ["a", "b", "c"], lead: "c", shown: ["c", "a", "b"], more: 0 },
    { order: ["a", "b", "c", "d"], lead: "a", shown: ["a", "b", "c"], more: 1 },
    { order: ["a", "b", "c", "d", "e"], lead: "e", shown: ["e", "a", "b"], more: 2 },
    { order: ["a", "b"], lead: undefined, shown: ["a", "b"], more: 0 },
  ])("shows $shown and $more more for $order led by $lead", ({ order, lead, shown, more }) => {
    expect(clusterFaces(order, lead)).toEqual({ shown, more });
  });
});

describe("groupRowPress — a press on a group's row", () => {
  it.each([
    { case: "opens a folded group", open: false, mine: ["a", "b"], next: true, select: undefined },
    {
      case: "opens a folded group and the viewer's one Mate in it",
      open: false,
      mine: ["a"],
      next: true,
      select: "a",
    },
    {
      case: "only opens a group of colleagues' Mates",
      open: false,
      mine: [],
      next: true,
      select: undefined,
    },
    {
      case: "folds an open group, opening nothing",
      open: true,
      mine: ["a"],
      next: false,
      select: undefined,
    },
    {
      case: "only opens a group folded around the open conversation: the person stays where they are",
      open: false,
      mine: ["a"],
      current: true,
      next: true,
      select: undefined,
    },
  ])("$case", ({ open, mine, next, select, current = false }) => {
    expect(groupRowPress({ open, mine, current })).toEqual({
      open: next,
      select,
    });
  });
});

describe("groupHoldsCurrent — a folded group holds the open conversation's mark", () => {
  it.each([
    { case: "folded around the open Mate", open: false, active: "b", holds: true },
    { case: "open: the Mate's own row holds it", open: true, active: "b", holds: false },
    { case: "folded, another project's Mate open", open: false, active: "z", holds: false },
    { case: "folded, nothing open", open: false, active: undefined, holds: false },
  ])("$case", ({ open, active, holds }) => {
    expect(groupHoldsCurrent({ open, mates: ["a", "b"], active })).toBe(holds);
  });
});

describe("projectRowKey — the list's keys on a row", () => {
  it.each([
    { key: "ArrowDown", kind: "solo", open: false, action: "next" },
    { key: "j", kind: "group", open: false, action: "next" },
    { key: "ArrowUp", kind: "kid", open: false, action: "previous" },
    { key: "k", kind: "solo", open: false, action: "previous" },
    { key: "ArrowRight", kind: "group", open: false, action: "open" },
    { key: "ArrowRight", kind: "group", open: true, action: "into" },
    { key: "ArrowLeft", kind: "group", open: true, action: "fold" },
    { key: "ArrowLeft", kind: "group", open: false, action: undefined },
    { key: "ArrowLeft", kind: "kid", open: false, action: "out" },
    { key: "ArrowRight", kind: "solo", open: false, action: undefined },
    { key: "ArrowLeft", kind: "solo", open: false, action: undefined },
  ] as const)("$key on a $kind row (open: $open) → $action", ({ key, kind, open, action }) => {
    expect(projectRowKey({ key, modified: false, kind, open })).toBe(action);
  });

  it("leaves a modified key to whoever else wants it", () => {
    expect(projectRowKey({ key: "ArrowDown", modified: true, kind: "solo", open: false })).toBe(
      undefined,
    );
  });
});
