import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import {
  landingAfterDraw,
  menuDrawsLoadingRows,
  newProjectOffered,
  openMateReveal,
  slackAfterScroll,
  slackForFold,
} from "./SidebarProjects.logic";

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

// The list's loading rows stand from the boot frame's until rows of its own replace them; the
// menu holds what waits on the viewer until then too, so its row never pushes them down.
describe("menuDrawsLoadingRows — the list's loading rows, while it has nothing of its own", () => {
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
  const BIRTH = { placement: { kind: "mate" } } as unknown as ZeropsPlacedBirth;
  const NOTICE = { message: { text: "Couldn't read your projects" } } as never;
  const reading = { candidates: [], births: [], complete: false, reading: true, notice: null };
  it.each([
    { case: "nothing read yet, the listing on its way", input: reading, drawn: true },
    {
      case: "a Mate HQ lists",
      input: { ...reading, candidates: [project("crm-dev", "mate")] },
      drawn: false,
    },
    { case: "a Mate being made", input: { ...reading, births: [BIRTH] }, drawn: false },
    { case: "the listing complete", input: { ...reading, complete: true }, drawn: false },
    {
      case: "the listing saying something of its own",
      input: { ...reading, notice: NOTICE },
      drawn: false,
    },
    { case: "no listing on its way", input: { ...reading, reading: false }, drawn: false },
  ])("draws them for $case: $drawn", ({ input, drawn }) => {
    expect(menuDrawsLoadingRows(input)).toBe(drawn);
  });
});
