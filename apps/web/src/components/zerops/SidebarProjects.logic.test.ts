import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import {
  landingAfterDraw,
  menuDrawsLoadingRows,
  newProjectOffered,
  openMateReveal,
  opensOpenProject,
  slackAfterScroll,
  slackForFold,
  unfoldScroll,
  type MateReveal,
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

describe("opensOpenProject — the open conversation's project opens around it", () => {
  it.each([
    {
      title: "a project the menu has not drawn folded opens around the conversation",
      paintedFolded: undefined,
      conversation: "c1",
      opens: true,
    },
    {
      title:
        "a reload on a Mate's conversation leaves its project folded once the menu drew it folded",
      paintedFolded: "c1",
      conversation: "c1",
      opens: false,
    },
    {
      title: "a conversation opened after the menu drew its project folded opens the project",
      paintedFolded: "c1",
      conversation: "c2",
      opens: true,
    },
    {
      title: "a project drawn folded while no conversation was open opens for one opened after",
      paintedFolded: null,
      conversation: "c1",
      opens: true,
    },
  ])("$title", ({ paintedFolded, conversation, opens }) => {
    expect(opensOpenProject({ groupId: "g", paintedFolded, conversation })).toBe(opens);
  });

  it("opens nothing while the open conversation's project is not known", () => {
    expect(
      opensOpenProject({ groupId: undefined, paintedFolded: undefined, conversation: "c1" }),
    ).toBe(false);
  });
});

describe("openMateReveal", () => {
  const MILO = "env-milo";
  const FEN = "env-fen";
  const seen = (conversation: string | null, shown: string | null, owed = false): MateReveal => ({
    conversation,
    shown,
    owed,
  });
  // Stress run 3 (+17:00): the open Mate was found after the menu drew, the menu then slid to it.
  it.each([
    [
      "a reload on an open Mate",
      { seen: seen(MILO, "milo"), conversation: MILO, open: "milo", resolving: false },
      undefined,
    ],
    [
      "a reload while the open Mate is still being found",
      { seen: undefined, conversation: MILO, open: null, resolving: true },
      undefined,
    ],
    [
      "a reload's open Mate found after the menu drew",
      { seen: seen(MILO, null), conversation: MILO, open: "milo", resolving: false },
      undefined,
    ],
    [
      "a Mate opened from elsewhere",
      { seen: seen(MILO, "milo"), conversation: FEN, open: "fen", resolving: false },
      "fen",
    ],
    [
      "a Mate opened where none was",
      { seen: seen(null, null), conversation: FEN, open: "fen", resolving: false },
      "fen",
    ],
    [
      "no Mate open",
      { seen: seen(MILO, "milo"), conversation: null, open: null, resolving: false },
      undefined,
    ],
  ] as const)(
    "A reload leaves the menu where it was; only a Mate opened afterwards scrolls into view: %s",
    (_case, input, reveal) => {
      expect(openMateReveal(input).reveal).toBe(reveal);
    },
  );

  /** Each draw's reveal, the caller marking a revealed row as shown, as the menu does. */
  const walk = (
    draws: ReadonlyArray<{
      readonly conversation: string | null;
      readonly open: string | null;
      readonly resolving?: boolean;
    }>,
  ) => {
    let state: MateReveal | undefined;
    return draws.map(({ conversation, open, resolving = false }) => {
      const next = openMateReveal({ seen: state, conversation, open, resolving });
      state =
        next.reveal === undefined ? next.seen : { conversation, shown: next.reveal, owed: false };
      return next.reveal;
    });
  };

  it("The open Mate a reload finds late is the one it opened on, not one opened afterwards", () => {
    expect(
      walk([
        { conversation: MILO, open: null, resolving: true },
        { conversation: MILO, open: "milo" },
        { conversation: MILO, open: "milo" },
        { conversation: FEN, open: "fen" },
      ]),
    ).toEqual([undefined, undefined, undefined, "fen"]);
  });

  it("A reload's open Mate the listing first misses and finds later is not scrolled to", () => {
    expect(
      walk([
        { conversation: MILO, open: null, resolving: true },
        { conversation: MILO, open: null },
        { conversation: MILO, open: null, resolving: true },
        { conversation: MILO, open: "milo" },
      ]),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("A Mate opened afterwards is scrolled to once, however often its rows are drawn again", () => {
    expect(
      walk([
        { conversation: MILO, open: "milo" },
        { conversation: FEN, open: null, resolving: true },
        { conversation: FEN, open: null },
        { conversation: FEN, open: "fen" },
        { conversation: FEN, open: null, resolving: true },
        { conversation: FEN, open: "fen" },
      ]),
    ).toEqual([undefined, undefined, undefined, "fen", undefined, undefined]);
  });

  it("A Mate lit by a press is brought into view, and not again when its conversation opens", () => {
    expect(
      walk([
        { conversation: MILO, open: "milo" },
        { conversation: MILO, open: "fen" },
        { conversation: FEN, open: "fen" },
      ]),
    ).toEqual([undefined, "fen", undefined]);
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

describe("unfoldScroll — a group opened at the list's end brings its Mates into view", () => {
  const view = { top: 100, bottom: 700 };
  it.each([
    {
      case: "its Mates stand wholly in view: the list stays",
      unit: { top: 500, bottom: 650 },
      by: 0,
    },
    {
      case: "its Mates end exactly at the view's edge: the list stays",
      unit: { top: 500, bottom: 700 },
      by: 0,
    },
    {
      case: "its Mates end below the view: it scrolls by what hangs below",
      unit: { top: 600, bottom: 780 },
      by: 80,
    },
    {
      case: "its heading is the list's last row, its Mates wholly below: they come up under it",
      unit: { top: 650, bottom: 830 },
      by: 130,
    },
    {
      case: "more Mates than the view holds: the heading stops at the view's top",
      unit: { top: 450, bottom: 1250 },
      by: 350,
    },
    {
      case: "its heading already above the view: nothing scrolls it further up",
      unit: { top: 40, bottom: 900 },
      by: 0,
    },
  ])("$case", ({ unit, by }) => {
    expect(unfoldScroll({ view, unit })).toBe(by);
  });
});
