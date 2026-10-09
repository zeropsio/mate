import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import {
  headingFaces,
  landingAfterDraw,
  newProjectOffered,
  openMateReveal,
  projectRoom,
  slackAfterScroll,
  slackForFold,
} from "./SidebarProjects.logic";

describe("projectRoom", () => {
  // The room belongs to the end of an open project, never above a heading:
  // opening one unfolds its rows — and the room after them — below it, so the
  // heading that was clicked stays where it is (M9).
  it.each([
    { name: "an open project, another under it", open: true, last: false, room: 36 },
    { name: "the list's last project, open", open: true, last: true, room: 16 },
    {
      name: "a folded project: its name, then 12 px — folded names stand 44 px apart",
      open: false,
      last: false,
      room: 12,
    },
    { name: "the list's last project, folded", open: false, last: true, room: 0 },
  ])("$name keeps $room px below its rows", ({ open, last, room }) => {
    expect(projectRoom({ open, last })).toBe(room);
  });
});

describe("headingFaces — who a folded project's heading shows (M15)", () => {
  // Each as its row draws it (`mateRowView`): the state, the face, the dot.
  const ROW = {
    idle: { face: "idle", dot: undefined },
    paused: { face: "sleep", dot: undefined },
    working: { face: "working", dot: undefined },
    needs: { face: "needs", dot: "attention" },
    unread: { face: "done", dot: "unread" },
    failed: { face: "idle", dot: "failed" },
  } as const;
  const mate = (projectId: string, state: keyof typeof ROW) => ({
    projectId,
    name: projectId,
    tint: "slate" as const,
    shape: "gem" as const,
    state,
    ...ROW[state],
    known: true,
  });

  it.each([
    { name: "nobody busy: no faces", mates: [mate("a", "idle"), mate("b", "paused")], shown: [] },
    { name: "working: the face alone", mates: [mate("a", "working")], shown: [["a", undefined]] },
    { name: "needs you: amber", mates: [mate("a", "needs")], shown: [["a", "attention"]] },
    { name: "stopped on an error: red", mates: [mate("a", "failed")], shown: [["a", "failed"]] },
    { name: "finished, not seen: blue", mates: [mate("a", "unread")], shown: [["a", "unread"]] },
    {
      name: "the most urgent first, the list's order kept within each, three at most",
      mates: [
        mate("w1", "working"),
        mate("u1", "unread"),
        mate("n1", "needs"),
        mate("f1", "failed"),
        mate("n2", "needs"),
      ],
      shown: [
        ["n1", "attention"],
        ["n2", "attention"],
        ["f1", "failed"],
      ],
    },
  ])("$name", ({ mates, shown }) => {
    expect(headingFaces(mates).map((face) => [face.projectId, face.dot])).toEqual(shown);
  });

  it("wears the row's face: still where it stopped on an error", () => {
    expect(headingFaces([mate("a", "failed")])).toEqual([
      {
        projectId: "a",
        name: "a",
        tint: "slate",
        shape: "gem",
        face: "idle",
        dot: "failed",
        known: true,
      },
    ]);
  });
});

describe("landingAfterDraw — a reveal lands on the draw after its ask, or never", () => {
  it.each([
    { name: "nothing asked", pending: null, land: undefined, next: null },
    {
      name: "the draw the ask came in waits for the one it set off",
      pending: { target: "stop:links-prod", drawn: false },
      land: undefined,
      next: { target: "stop:links-prod", drawn: true },
    },
    {
      name: "the draw after it lands the ask, and the ask is done either way",
      pending: { target: "stop:links-prod", drawn: true },
      land: "stop:links-prod",
      next: null,
    },
  ])("$name", ({ pending, land, next }) => {
    expect(landingAfterDraw(pending)).toEqual({ land, next });
  });
});

// Scrolled to the list's end, a fold shortens the list under the view, and
// the view — held at the list's end — would slide everything down, the
// heading pressed with it. The room the view would lack stays at the end
// until a scroll up no longer needs it (M9).
describe("slackForFold — the room a fold leaves at the list's end", () => {
  it.each([
    {
      name: "the list's end far below the view: none",
      scroll: { scrollTop: 0, clientHeight: 500, scrollHeight: 2000, slack: 0 },
      removed: 300,
      slack: 0,
    },
    {
      name: "scrolled to the end: all the rows fold out of",
      scroll: { scrollTop: 1500, clientHeight: 500, scrollHeight: 2000, slack: 0 },
      removed: 300,
      slack: 300,
    },
    {
      name: "200 px short of the end: what the view would lack",
      scroll: { scrollTop: 1300, clientHeight: 500, scrollHeight: 2000, slack: 0 },
      removed: 300,
      slack: 100,
    },
    {
      name: "a list shorter than its view, at the top: nothing moves, none",
      scroll: { scrollTop: 0, clientHeight: 800, scrollHeight: 600, slack: 0 },
      removed: 200,
      slack: 0,
    },
    {
      name: "a list only a little longer than its view, scrolled 50 px: all the view lacks",
      scroll: { scrollTop: 50, clientHeight: 800, scrollHeight: 850, slack: 0 },
      removed: 200,
      slack: 200,
    },
    {
      name: "the room a fold before left, counted in",
      scroll: { scrollTop: 1500, clientHeight: 500, scrollHeight: 2100, slack: 100 },
      removed: 300,
      slack: 300,
    },
  ])("$name", ({ scroll, removed, slack }) => {
    expect(slackForFold(scroll, removed)).toBe(slack);
  });
});

describe("slackAfterScroll — the room shrinks as a scroll up stops needing it", () => {
  it.each([
    {
      name: "where the fold left it: all of it",
      scroll: { scrollTop: 1500, clientHeight: 500, scrollHeight: 2000, slack: 300 },
      slack: 300,
    },
    {
      name: "120 px up: 120 px less",
      scroll: { scrollTop: 1380, clientHeight: 500, scrollHeight: 2000, slack: 300 },
      slack: 180,
    },
    {
      name: "far up: none",
      scroll: { scrollTop: 200, clientHeight: 500, scrollHeight: 2000, slack: 300 },
      slack: 0,
    },
    {
      name: "back at the top: none",
      scroll: { scrollTop: 0, clientHeight: 800, scrollHeight: 1000, slack: 200 },
      slack: 0,
    },
    {
      name: "never more than it was",
      scroll: { scrollTop: 1500, clientHeight: 600, scrollHeight: 2000, slack: 300 },
      slack: 300,
    },
  ])("$name", ({ scroll, slack }) => {
    expect(slackAfterScroll(scroll)).toBe(slack);
  });
});

// *New project* stands at the menu's foot, the same place whatever the list's
// length (the owner, 2026-09-29: "not sure if this shouldn't be stuck to the
// bottom somehow") — from the first paint, so it is there before the listing
// is read, and taken away only where the list's own empty state is the one
// thing to do.
describe("newProjectOffered — New project at the menu's foot (D11)", () => {
  /** A project of CRM, where HQ places it as `kind`. */
  const project = (id: string, kind: "mate" | "stage"): ZeropsCandidate => ({
    key: `${id}:zcp`,
    project: {
      id,
      name: id,
      status: "ACTIVE",
      tagList: kind === "mate" ? ["mate"] : [],
      hq: { appId: "crm", appName: "CRM", kind, mate: null },
    },
    group: "ready",
  });
  const MATE = project("crm-dev", "mate");
  const STAGE = project("crm-stage", "stage");
  const BIRTH = { placement: { kind: "mate" } } as unknown as ZeropsPlacedBirth;

  it.each([
    { name: "Mates listed", candidates: [MATE, STAGE], births: [], complete: true, offered: true },
    {
      name: "Mates listed, the rest still read",
      candidates: [MATE],
      births: [],
      complete: false,
      offered: true,
    },
    {
      name: "no project at all: the one way in",
      candidates: [],
      births: [],
      complete: true,
      offered: true,
    },
    {
      name: "the listing still read: there from the first paint",
      candidates: [],
      births: [],
      complete: false,
      offered: true,
    },
    {
      name: "projects, none with a Mate: the list's own Set up Mate is the one thing to do",
      candidates: [STAGE],
      births: [],
      complete: true,
      offered: false,
    },
    {
      name: "projects, none with a Mate yet, but one being made",
      candidates: [STAGE],
      births: [BIRTH],
      complete: true,
      offered: true,
    },
  ])("$name: $offered", ({ candidates, births, complete, offered }) => {
    expect(newProjectOffered({ candidates, births, complete })).toBe(offered);
  });
});

describe("openMateReveal", () => {
  // Stress run 3 (+17:00): the open Mate was found after the menu drew, the menu then slid to it.
  it.each([
    ["a reload on an open Mate", { seen: "milo", open: "milo", resolving: false }, undefined],
    [
      "a reload while the open Mate is still being found",
      { seen: undefined, open: null, resolving: true },
      undefined,
    ],
    [
      "a reload's open Mate found after the menu drew",
      { seen: undefined, open: "milo", resolving: false },
      undefined,
    ],
    ["a Mate opened from elsewhere", { seen: "milo", open: "fen", resolving: false }, "fen"],
    ["a Mate opened where none was", { seen: null, open: "fen", resolving: false }, "fen"],
    ["no Mate open", { seen: "milo", open: null, resolving: false }, undefined],
  ] as const)(
    "A reload leaves the menu where it was; only a Mate opened afterwards scrolls into view: %s",
    (_case, input, reveal) => {
      expect(openMateReveal(input).reveal).toBe(reveal);
    },
  );

  it("The open Mate a reload finds late is the one it opened on, not one opened afterwards", () => {
    const found = openMateReveal({ seen: undefined, open: "milo", resolving: false });
    expect(openMateReveal({ seen: found.seen, open: "milo", resolving: false }).reveal).toBe(
      undefined,
    );
    expect(openMateReveal({ seen: found.seen, open: "fen", resolving: false }).reveal).toBe("fen");
  });
});
