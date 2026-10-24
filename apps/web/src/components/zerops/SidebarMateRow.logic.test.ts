import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { restingActivity, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { MateComing } from "@t3tools/client-runtime/data";
import { MATE_STAND_UP_MESSAGE } from "~/zerops/mateStandUp";

import {
  changeMarkTone,
  mateBornLine,
  mateBornLineText,
  mateComingRowView,
  pendingBornLine,
  mateCrewItem,
  mateDeletingView,
  mateFinishingView,
  mateOwnerView,
  mateNotYours,
  mateRowHeldLines,
  mateRowPropsEqual,
  mateRowSecond,
  mateAutomation,
  mateRowTime,
  changeLineWords,
  tasksWaitingWords,
  type MateRowView,
  ownerBadge,
  mateRowAskLine,
  mateAsker,
  mateRowDraft,
  mateRowReading,
  mateRowView,
  ownerMark,
  mateRowOffersMenu,
} from "./SidebarMateRow.logic";

describe("ownerMark — whose Mate it is, as a 16 px mark before its name", () => {
  it.each([
    {
      case: "a person with a picture",
      owner: { name: "Petra Malá", initials: "PM", avatarUrl: "https://cdn/petra.png" },
      initial: "P",
      picture: "https://cdn/petra.png",
    },
    {
      case: "a person without one",
      owner: { name: "Jan Beneš", initials: "JB", avatarUrl: null },
      initial: "J",
      picture: null,
    },
    {
      case: "a picture that is an empty string",
      owner: { name: "Eva Dvořák", initials: "ed", avatarUrl: "" },
      initial: "E",
      picture: null,
    },
  ])("draws $case", ({ owner, initial, picture }) => {
    expect(ownerMark(owner)).toMatchObject({
      initial,
      picture,
      label: `${owner.name}'s Mate`,
    });
  });

  it("gives one person one hue, every time, on the colour wheel", () => {
    const petra = { name: "Petra Malá", initials: "PM", avatarUrl: null };
    const hue = ownerMark(petra).hue;
    expect(ownerMark(petra).hue).toBe(hue);
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("tells people apart by their hue", () => {
    const hues = new Set(
      ["Petra Malá", "Jan Beneš", "Eva Dvořák", "Tomáš Holý", "Dana Krausová"].map(
        (name) => ownerMark({ name, initials: name.slice(0, 1), avatarUrl: null }).hue,
      ),
    );
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });
});

// A Mate with no owner, or nobody signed in (the owner, 2026-09-29: "mate
// without auth / owner should have the state specially handled"). Three
// seats — a person, somebody the member list has not named, nobody — and the
// row's own line where nobody has signed its agent in.
describe("mateOwnerView — whose seat, and whether anybody signed its agent in", () => {
  const PETRA = { name: "Petra Malá", initials: "PM", avatarUrl: null, isViewer: true };
  const KAREL = { name: "Alex Novák", initials: "AN", avatarUrl: null, isViewer: false };
  const NOBODY = { named: false, signedIn: false };
  const OWNED_UNSIGNED = { named: true, signedIn: false };
  const SIGNED = { named: true, signedIn: true };
  const LINE = "Nobody has signed in yet";

  // The line is a fact with nothing to press on it: the row's own press opens
  // the Mate, whose conversation holds the sign-in (the owner, 2026-09-29, of
  // a *Sign in* on the row: it did nothing there, and stood on the row's edge).
  it.each([
    {
      case: "a named owner, signed in: the person, no line",
      owner: KAREL,
      records: SIGNED,
      asked: false,
      seat: "person",
      line: undefined,
    },
    {
      case: "recorded, the member list not read, failed, or without them: a neutral seat",
      owner: undefined,
      records: SIGNED,
      asked: false,
      seat: "unnamed",
      line: undefined,
    },
    {
      case: "nobody's and never asked: the empty seat and the line",
      owner: undefined,
      records: NOBODY,
      asked: false,
      seat: "nobody",
      line: LINE,
    },
    {
      case: "nobody's, but asked already (a project token): the empty seat and its own lines",
      owner: undefined,
      records: NOBODY,
      asked: true,
      seat: "nobody",
      line: undefined,
    },
    {
      case: "the viewer's own, nobody signed in: their picture and the line",
      owner: PETRA,
      records: OWNED_UNSIGNED,
      asked: false,
      seat: "person",
      line: LINE,
    },
    {
      case: "a colleague's, nobody signed in: their picture and the line",
      owner: KAREL,
      records: OWNED_UNSIGNED,
      asked: false,
      seat: "person",
      line: LINE,
    },
    {
      case: "its roles not read, nobody signed in: a neutral seat, never nobody's, and the line",
      owner: undefined,
      records: { named: undefined, signedIn: false },
      asked: false,
      seat: "unnamed",
      line: LINE,
    },
    {
      case: "an owner not named yet, nobody signed in: a neutral seat and the line",
      owner: undefined,
      records: OWNED_UNSIGNED,
      asked: false,
      seat: "unnamed",
      line: LINE,
    },
  ])("$case", ({ owner, records, asked, seat, line }) => {
    const view = mateOwnerView({ owner, records, asked, hqSigners: "none", overview: "live" });
    expect(view.seat.kind).toBe(seat);
    expect(view.signInLine).toBe(line);
  });

  // A Mate HQ has never heard from holds no word on its sign-ins either way: the page says it is
  // not connected to HQ, and the row does not claim a sign-in it cannot know of.
  it.each([
    { case: "no presence at all", overview: undefined, line: undefined, waits: false },
    {
      case: "offline, HQ holds no overview of it",
      overview: "none",
      line: undefined,
      waits: false,
    },
    {
      case: "offline, HQ holds its stored overview",
      overview: "stored",
      line: "Waiting for your sign-in",
      waits: true,
    },
    {
      case: "linked, its overview live",
      overview: "live",
      line: "Waiting for your sign-in",
      waits: true,
    },
  ] as const)(
    "A Mate HQ has never heard from says nothing of a sign-in, even to the person who made it: $case",
    ({ overview, line, waits }) => {
      const view = mateOwnerView({
        owner: undefined,
        records: { named: true, signedIn: false },
        asked: false,
        hqSigners: "none",
        overview,
        madeBy: "user-petra",
        viewer: "user-petra",
        linked: true,
      });
      expect(view.signInLine).toBe(line);
      expect(view.waitsOnViewer).toBe(waits);
    },
  );

  // Whose sign-in a new Mate waits for (board D1, 2026-09-30): the person who added it — HQ's
  // stand-up record names them until their sign-in lets it run — reads that it waits
  // on them, with the amber dot of what needs them. A Mate still being set up never reads like a
  // failure (the owner, 2026-10-01, of "none signed in" on a Mate setting up): anybody else reads
  // that it waits for a sign-in, quietly, and a viewer not known yet reads nothing.
  it.each([
    {
      case: "nobody signed in, the viewer added it: it waits on them",
      records: NOBODY,
      standUpBy: "user-petra",
      viewer: "user-petra",
      line: "Waiting for your sign-in",
      waits: true,
    },
    {
      case: "nobody signed in, somebody else added it: it waits for a sign-in",
      records: NOBODY,
      standUpBy: "user-karel",
      viewer: "user-petra",
      line: "Waiting for sign-in",
      waits: false,
    },
    {
      case: "nobody signed in, nobody named as adding it: the fact",
      records: OWNED_UNSIGNED,
      standUpBy: undefined,
      viewer: "user-petra",
      line: LINE,
      waits: false,
    },
    {
      case: "nobody signed in, the viewer not known yet: nothing",
      records: NOBODY,
      standUpBy: "user-petra",
      viewer: undefined,
      line: undefined,
      waits: false,
    },
    {
      case: "signed in: no line, whoever added it",
      records: SIGNED,
      standUpBy: "user-petra",
      viewer: "user-petra",
      line: undefined,
      waits: false,
    },
  ])("$case", ({ records, standUpBy, viewer, line, waits }) => {
    const view = mateOwnerView({
      owner: undefined,
      records,
      asked: false,
      hqSigners: "none",
      overview: "live",
      standUpBy,
      viewer,
      linked: true,
    });
    expect(view.signInLine).toBe(line);
    expect(view.waitsOnViewer).toBe(waits);
  });

  // HQ's signers decide whether anybody signed its agent in (the owner, 2026-10-06: every row said
  // "Nobody has signed in yet" of Mates in use): the line stands only where HQ says nobody did,
  // never while HQ has not said.
  it.each([
    { case: "HQ names a signer: no line", hqSigners: "some", line: undefined },
    { case: "HQ names nobody: the line", hqSigners: "none", line: LINE },
    { case: "HQ has not said: nothing", hqSigners: undefined, line: undefined },
  ] as const)("$case", ({ hqSigners, line }) => {
    const view = mateOwnerView({
      owner: undefined,
      records: OWNED_UNSIGNED,
      asked: false,
      hqSigners,
      overview: "live",
    });
    expect(view.signInLine).toBe(line);
  });

  it("waits for nobody's sign-in while HQ has not said who signed in", () => {
    const view = mateOwnerView({
      owner: undefined,
      records: NOBODY,
      asked: false,
      hqSigners: undefined,
      standUpBy: "user-petra",
      viewer: "user-petra",
      linked: true,
    });
    expect(view).toMatchObject({ signInLine: undefined, waitsOnViewer: false });
  });

  // The row follows what the page knows (the owner, 2026-09-30, Pia: the row asked for the
  // sign-in with its dot while the page still said Connecting…): its words stand from the first
  // paint, and it waits on the viewer — the dot — only once the page can show the sign-in.
  it.each([
    { case: "its link not made yet: the words, no dot", linked: false, waits: false },
    { case: "its link made: it waits on the viewer", linked: true, waits: true },
  ])("$case", ({ linked, waits }) => {
    const view = mateOwnerView({
      owner: undefined,
      records: NOBODY,
      asked: false,
      hqSigners: "none",
      overview: "live",
      standUpBy: "user-petra",
      viewer: "user-petra",
      linked,
    });
    expect(view.signInLine).toBe("Waiting for your sign-in");
    expect(view.waitsOnViewer).toBe(waits);
  });

  // One state, one phrase whichever flow made it (run 4, 2026-10-02): a Mate New project made asks
  // no stand-up, and still waits for the sign-in of whoever made it, as HQ's record names them.
  it.each([
    {
      case: "made by the viewer, no stand-up asked: it waits on them",
      madeBy: "user-petra",
      standUpBy: undefined,
      line: "Waiting for your sign-in",
      waits: true,
    },
    {
      case: "made by somebody else, no stand-up asked: it waits for a sign-in",
      madeBy: "user-karel",
      standUpBy: undefined,
      line: "Waiting for sign-in",
      waits: false,
    },
    {
      case: "made by the viewer, a stand-up asked by somebody else: it still waits on its maker",
      madeBy: "user-petra",
      standUpBy: "user-karel",
      line: "Waiting for your sign-in",
      waits: true,
    },
  ])("$case", ({ madeBy, standUpBy, line, waits }) => {
    const view = mateOwnerView({
      owner: undefined,
      records: NOBODY,
      asked: false,
      hqSigners: "none",
      overview: "live",
      madeBy,
      standUpBy,
      viewer: "user-petra",
      linked: true,
    });
    expect(view.signInLine).toBe(line);
    expect(view.waitsOnViewer).toBe(waits);
  });

  // Mate signs people in to Claude Code and Codex only: a Mate on Cursor, OpenCode, Grok or
  // Antigravity (HQ's overview) waits on no sign-in, and is its maker's, as its records say.
  it.each([
    { case: "its maker named: their picture", owner: PETRA, named: true, seat: "person" },
    {
      case: "its maker not named yet: a neutral seat",
      owner: undefined,
      named: true,
      seat: "unnamed",
    },
    {
      case: "nobody named as making it: the empty seat",
      owner: undefined,
      named: false,
      seat: "nobody",
    },
  ])("runs without a sign-in, $case, and no line", ({ owner, named, seat }) => {
    const view = mateOwnerView({
      owner,
      records: { named, signedIn: false, runsWithoutSignIn: true },
      asked: false,
      hqSigners: "none",
      overview: "live",
      madeBy: "user-petra",
      viewer: "user-petra",
      linked: true,
    });
    expect([view.seat.kind, view.signInLine, view.waitsOnViewer]).toEqual([seat, undefined, false]);
  });

  it("says the empty seat in words, and draws a person as their mark", () => {
    expect(
      mateOwnerView({
        owner: undefined,
        records: NOBODY,
        asked: true,
        hqSigners: "none",
        overview: "live",
      }).seat,
    ).toEqual({
      kind: "nobody",
      label: "No owner yet. Whoever signs in its coding agent owns it.",
    });
    expect(
      mateOwnerView({
        owner: KAREL,
        records: SIGNED,
        asked: true,
        hqSigners: "some",
        overview: "live",
      }).seat,
    ).toEqual({
      kind: "person",
      mark: ownerMark(KAREL),
    });
  });
});

// The owner, 2026-09-29: "allow setting up crew from more menu in the left col".
describe("mateCrewItem — the crew's door in a Mate's own menu", () => {
  const MINE = { isViewer: true };
  const COLLEAGUES = { isViewer: false };
  const SET_UP = { label: "Set up a crew", setUp: true };
  const CREW = { label: "Crew", setUp: false };

  it.each([
    { case: "crew mode not read yet", status: null, owner: MINE, item: null },
    { case: "crew mode off", status: "off", owner: MINE, item: null },
    { case: "the viewer's own, without a crew", status: "none", owner: MINE, item: SET_UP },
    { case: "the viewer's own, with a crew", status: "applied", owner: MINE, item: CREW },
    { case: "a colleague's, without a crew", status: "none", owner: COLLEAGUES, item: null },
    { case: "a colleague's, with a crew", status: "applied", owner: COLLEAGUES, item: null },
    { case: "one whose owner is not named", status: "applied", owner: undefined, item: null },
  ] as const)("$case", ({ status, owner, item }) => {
    expect(mateCrewItem({ status, owner })).toEqual(item);
  });

  // D6: its agent signed in by somebody else, the viewer may read a crew and not set one up.
  it.each([
    { case: "without a crew", status: "none", item: null },
    { case: "with a crew", status: "applied", item: CREW },
  ] as const)("the viewer's own, on a login they may not run, $case", ({ status, item }) => {
    expect(mateCrewItem({ status, owner: MINE, mayChange: false })).toEqual(item);
  });
});

describe("changeMarkTone — the one colour a change row's mark may wear", () => {
  const change = (overrides: Partial<Parameters<typeof changeMarkTone>[0]> = {}) => ({
    number: 4,
    mergeability: "mergeable" as const,
    ...overrides,
  });
  // Amber is "didn't go through" (S3); everything else is the mark's own grey
  // — the verdict itself lives in the review.
  it.each([
    { case: "merges", pull: change(), tone: undefined },
    { case: "behind main", pull: change({ mergeability: "conflicting" }), tone: "attention" },
    { case: "HQ still checking", pull: change({ mergeability: "checking" }), tone: undefined },
  ] as const)("$case: $tone", ({ pull, tone }) => {
    expect(changeMarkTone(pull)).toBe(tone);
  });
});

describe("mateRowView — a row's state lives in its right slot and its third line", () => {
  const AT = "2026-09-29T08:00:00.000Z";
  const activity = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Speed up the photo gallery",
    at: AT,
    snippet: "Thumbnails load lazily now; the gallery opens in 90 ms.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
    ...overrides,
  });
  const face = (overrides: Partial<ZeropsAgentActivity> = {}) => activity(overrides).face;

  // The plan's table (M7): no status words anywhere — the face, a dot and
  // the content itself say it.
  it.each([
    {
      case: "idle, seen",
      input: activity(),
      state: "idle",
      rowFace: "idle",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: {
        kind: "words",
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
        tone: "muted",
      },
    },
    {
      case: "working, its live step relayed",
      input: activity({
        kind: "working",
        face: "working",
        subject: "Compile the gallery",
        liveStep: { words: "Compile the gallery" },
      }),
      state: "working",
      rowFace: "working",
      slot: { kind: "clock", since: AT },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Compile the gallery" },
    },
    // Run 11 (D8): the card's own words, its clock stopped with its turn.
    {
      case: "its turn over, its helpers at work",
      input: activity({ kind: "working", face: "working", waitsOnHelpers: true }),
      state: "working",
      rowFace: "working",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Waiting for its helpers" },
    },
    // Eli, 2026-10-14: its own background checks ran, no helper did.
    {
      case: "its turn over, its own background job running",
      input: activity({
        kind: "working",
        face: "working",
        waitsOnHelpers: true,
        backgroundWork: {
          items: [{ title: "Final batched browser check", of: "mate", since: 1 }],
          count: 1,
        },
      }),
      state: "working",
      rowFace: "working",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Final batched browser check" },
    },
    // S21-02: "Finishing work it started" read on after the person's Stop.
    {
      case: "a Stop in force on its turn: it says it is stopping",
      input: activity({
        kind: "working",
        face: "working",
        stopping: true,
        liveStep: { words: "Compile the gallery" },
      }),
      state: "working",
      rowFace: "working",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Stopping…" },
    },
    {
      case: "a Stop in force on the work its turn left: it says it is stopping, never what still runs",
      input: activity({
        kind: "working",
        face: "working",
        waitsOnHelpers: true,
        stopping: true,
        backgroundWork: {
          items: [{ title: "Final batched browser check", of: "mate", since: 1 }],
          count: 1,
        },
      }),
      state: "working",
      rowFace: "working",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Stopping…" },
    },
    {
      case: "working, no step relayed",
      input: activity({ kind: "working", face: "working" }),
      state: "working",
      rowFace: "working",
      slot: { kind: "clock", since: AT },
      dot: undefined,
      strong: false,
      reply: { kind: "pending" },
    },
    {
      case: "needs you, its question relayed",
      input: activity({
        kind: "input",
        face: "needs",
        question: "Ship the new gallery today, or after the weekend?",
      }),
      state: "needs",
      rowFace: "needs",
      slot: { kind: "age" },
      dot: "attention",
      strong: false,
      reply: {
        kind: "words",
        text: "Ship the new gallery today, or after the weekend?",
        tone: "ink",
      },
    },
    {
      case: "needs you, no question relayed",
      input: activity({ kind: "approval", face: "needs" }),
      state: "needs",
      rowFace: "needs",
      slot: { kind: "age" },
      dot: "attention",
      strong: false,
      reply: {
        kind: "words",
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
        tone: "ink",
      },
    },
    {
      case: "finished, not seen",
      input: activity({ kind: "done", face: "done", unread: true }),
      state: "unread",
      rowFace: "done",
      slot: { kind: "age" },
      dot: "unread",
      strong: true,
      reply: {
        kind: "words",
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
        tone: "ink-2",
      },
    },
    {
      case: "stopped on an error",
      input: activity({
        kind: "failed",
        face: "needs",
        errorLine: "The type check found 2 errors in src/gallery/grid.ts",
      }),
      state: "failed",
      rowFace: "idle",
      slot: { kind: "age" },
      dot: "failed",
      strong: false,
      reply: {
        kind: "words",
        text: "The type check found 2 errors in src/gallery/grid.ts",
        tone: "failed",
      },
    },
    {
      case: "stopped on an error it did not name",
      input: activity({ kind: "failed", face: "needs" }),
      state: "failed",
      rowFace: "idle",
      slot: { kind: "age" },
      dot: "failed",
      strong: false,
      reply: {
        kind: "words",
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
        tone: "muted",
      },
    },
    {
      case: "paused at a usage limit",
      input: activity({ face: "sleep", pausedUntil: "2026-09-29T14:20:00.000Z" }),
      state: "paused",
      rowFace: "sleep",
      slot: { kind: "paused", until: "2026-09-29T14:20:00.000Z" },
      dot: "attention",
      strong: false,
      reply: {
        kind: "words",
        text: "The Mate hit the coding agent's limit.",
        tone: "muted",
      },
    },
    {
      // A turn that hits the limit ends failed, the session in error, while
      // the pause stands: it sleeps until the limit resets, and the resume
      // picks the work up without anybody (`mateMarkStateForThread`) — no
      // red dot, no error line.
      case: "paused at a usage limit its last turn failed on",
      input: activity({
        kind: "failed",
        face: "sleep",
        pausedUntil: "2026-09-29T14:20:00.000Z",
        errorLine: "Claude usage limit reached. Your limit resets at 14:20.",
      }),
      state: "paused",
      rowFace: "sleep",
      slot: { kind: "paused", until: "2026-09-29T14:20:00.000Z" },
      dot: "attention",
      strong: false,
      reply: {
        kind: "words",
        text: "The Mate hit the Claude limit.",
        tone: "muted",
      },
    },
    {
      case: "a generic weekly refusal keeps the projected provider name",
      input: activity({
        kind: "failed",
        face: "sleep",
        usageLimited: true,
        limitProvider: "Claude",
        errorLine: "You've hit your weekly limit",
        pausedUntil: "2026-10-10T00:00:00.000Z",
      }),
      state: "paused",
      rowFace: "sleep",
      dot: "attention",
      strong: false,
      slot: { kind: "paused", until: "2026-10-10T00:00:00.000Z" },
      reply: { kind: "words", text: "The Mate hit the Claude limit.", tone: "muted" },
    },
    {
      case: "sent, its run not started yet",
      input: activity({ snippet: undefined, awaitingWords: true }),
      state: "idle",
      rowFace: "idle",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: { kind: "pending" },
    },
    {
      case: "asked, with no answer",
      input: activity({ snippet: undefined }),
      state: "idle",
      rowFace: "idle",
      slot: { kind: "age" },
      dot: undefined,
      strong: false,
      reply: undefined,
    },
  ] as const)("$case", ({ input, state, rowFace, slot, dot, strong, reply }) => {
    const view = mateRowView(input, input.face);
    expect(view.state).toBe(state);
    expect(view.face).toBe(rowFace);
    expect(view.slot).toEqual(slot);
    expect(view.dot).toBe(dot);
    expect(view.strongName).toBe(strong);
    expect(view.ask).toBe("Speed up the photo gallery");
    expect(view.reply).toEqual(reply);
  });

  // The owner, 2026-10-15: "unread is not highlighted at all". A result not seen — finished or
  // failed — hangs the unread dot by the row's time and sets its name strong; at work, waiting on
  // the person or paused, the face and the slot say what is going on instead.
  it.each([
    { case: "finished, not seen", input: activity({ face: "done", unread: true }), unseen: true },
    {
      case: "stopped on an error not seen",
      input: activity({ kind: "failed", face: "needs", errorLine: "Build broke", unread: true }),
      unseen: true,
    },
    {
      case: "stopped on an error seen",
      input: activity({ kind: "failed", face: "needs", errorLine: "Build broke" }),
      unseen: false,
    },
    {
      case: "at work",
      input: activity({ kind: "working", face: "working", unread: true }),
      unseen: false,
    },
    {
      case: "waiting on its person",
      input: activity({ kind: "input", face: "needs", unread: true }),
      unseen: false,
    },
    { case: "seen", input: activity(), unseen: false },
  ])("An unread Mate shows its dot beside the time: $case", ({ input, unseen }) => {
    const view = mateRowView(input, input.face);
    expect([view.unseen, view.strongName]).toEqual([unseen, unseen]);
  });

  it("asks the person's last ask, never the plan step the Mate is on", () => {
    const view = mateRowView(
      activity({ kind: "working", face: "working", subject: "Run the build", task: "Tune it" }),
      "working",
    );
    expect(view.ask).toBe("Tune it");
  });

  it("says nothing of a Mate nobody has spoken to: no age, no lines", () => {
    const view = mateRowView(
      activity({ subject: undefined, task: undefined, snippet: undefined }),
      "idle",
    );
    expect(view.slot).toEqual({ kind: "none" });
    expect(view.ask).toBeUndefined();
    expect(view.reply).toBeUndefined();
  });

  it("wears its own face where nothing is known of it: asleep, or idle", () => {
    expect(mateRowView(undefined, "sleep")).toMatchObject({
      state: "idle",
      face: "sleep",
      slot: { kind: "none" },
      dot: undefined,
      ask: undefined,
      reply: undefined,
    });
  });

  it("keeps a working row's third line whatever it said before, so nothing jumps", () => {
    const before = mateRowView(activity(), "idle");
    const working = mateRowView(activity({ kind: "working", face: "working" }), "working");
    expect(before.reply).toBeDefined();
    expect(working.reply).toBeDefined();
    expect(face({ kind: "working", face: "working" })).toBe("working");
  });

  // A new Mate's first run is the stand-up its person's sign-in sent (board D1, 2026-09-30):
  // while it works the row says what it is doing in the person's words, not the command sent on
  // their behalf; a run that stops says the setting up stopped; and from then on it is any Mate.
  it.each([
    {
      case: "the stand-up working: setting up development, on the run's clock",
      input: activity({
        kind: "working",
        face: "working",
        task: undefined,
        standUp: true,
        subject: "Clone the code into appdev",
        snippet: undefined,
        liveStep: { words: "Deploying appdev" },
      }),
      slot: { kind: "clock", since: AT },
      dot: undefined,
      ask: undefined,
      reply: { kind: "live", words: "Setting up development" },
    },
    {
      case: "the stand-up starting: setting up development already",
      input: activity({
        kind: "connecting",
        face: "working",
        task: undefined,
        subject: undefined,
        standUp: true,
        snippet: undefined,
        awaitingWords: true,
      }),
      slot: { kind: "clock", since: AT },
      dot: undefined,
      ask: undefined,
      reply: { kind: "live", words: "Setting up development" },
    },
    {
      case: "the stand-up stopped on an error: setting up stopped, red",
      input: activity({
        kind: "failed",
        face: "idle",
        task: undefined,
        subject: undefined,
        standUp: true,
        snippet: undefined,
        errorLine: "Build of appdev failed.",
      }),
      slot: { kind: "age" },
      dot: "failed",
      ask: undefined,
      reply: { kind: "words", text: "Setting up stopped", tone: "attention" },
    },
    {
      case: "the stand-up asking the person: any Mate's question",
      input: activity({
        kind: "input",
        face: "needs",
        task: MATE_STAND_UP_MESSAGE,
        question: "Which database should appdev use?",
      }),
      slot: { kind: "age" },
      dot: "attention",
      ask: MATE_STAND_UP_MESSAGE,
      reply: { kind: "words", text: "Which database should appdev use?", tone: "ink" },
    },
    {
      case: "the stand-up done: any Mate, what was asked and its answer",
      input: activity({
        task: MATE_STAND_UP_MESSAGE,
        snippet: "Development is up: appdev answers on its subdomain.",
      }),
      slot: { kind: "age" },
      dot: undefined,
      ask: MATE_STAND_UP_MESSAGE,
      reply: {
        kind: "words",
        text: "Development is up: appdev answers on its subdomain.",
        tone: "muted",
      },
    },
  ] as const)("$case", ({ input, slot, dot, ask, reply }) => {
    const view = mateRowView(input, input.face);
    expect(view.slot).toEqual(slot);
    expect(view.dot).toBe(dot);
    expect(view.ask).toBe(ask);
    expect(view.reply).toEqual(reply);
  });
});

describe("mateDeletingView — a Mate on its way off Zerops", () => {
  const activity = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Speed up the photo gallery",
    at: "2026-09-29T08:00:00.000Z",
    snippet: "Thumbnails load lazily now.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
    ...overrides,
  });
  const deleting = (input: ZeropsAgentActivity | undefined, face = input?.face ?? "sleep") =>
    mateDeletingView(mateRowView(input, face));

  // Its line under the name says so, in place of the row's last line: the
  // row keeps its height, and nothing on it says it waits on anybody.
  it.each([
    { case: "idle, seen", input: activity(), ask: "Speed up the photo gallery" },
    {
      case: "needing its person",
      input: activity({ kind: "idle", face: "needs", question: "Which gallery?" }),
      ask: "Speed up the photo gallery",
    },
    {
      case: "at work",
      input: activity({ kind: "working", face: "working" }),
      ask: "Speed up the photo gallery",
    },
    {
      case: "finished and not seen",
      input: activity({ unread: true }),
      ask: "Speed up the photo gallery",
    },
    {
      case: "asked, with no words back: the ask gives way",
      input: activity({ snippet: undefined }),
      ask: undefined,
    },
    { case: "never spoken to", input: undefined, ask: undefined },
  ])("$case", ({ input, ask }) => {
    expect(deleting(input)).toMatchObject({
      face: "sleep",
      slot: { kind: "none" },
      dot: undefined,
      strongName: false,
      ask,
      reply: undefined,
    });
  });
});

// Finish setup runs in place: its row says so where its last line stood, so the row keeps its
// height — and the Mate is not going anywhere, so its face, its time and its name stay as they were.
describe("mateFinishingView — a Mate whose setup is being finished", () => {
  const activity = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Speed up the photo gallery",
    at: "2026-09-29T08:00:00.000Z",
    snippet: "Thumbnails load lazily now.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
    ...overrides,
  });

  it.each([
    {
      case: "asked, with words back: the ask stays, the words give way",
      input: activity(),
      ask: "Speed up the photo gallery",
    },
    {
      case: "asked, with no words back: the ask gives way",
      input: activity({ snippet: undefined }),
      ask: undefined,
    },
    { case: "never spoken to", input: undefined, ask: undefined },
  ])("$case", ({ input, ask }) => {
    const view = mateRowView(input, input?.face ?? "sleep");
    expect(mateFinishingView(view)).toEqual({ ...view, ask, reply: undefined });
  });
});

// The owner, 2026-09-29, of a new Mate at work on its first job: its row read "Working on a
// reply" under an asleep face. The words came from one reading — what this browser remembered the
// row saying, while its candidate was not connected that instant — and the face from another.
// One reading now draws both, so they never disagree.
describe("mateRowReading — the face follows the work, and the words never outrun the face", () => {
  const AT = "2026-09-29T20:10:00.000Z";
  const reading = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "working",
    status: null,
    face: "working",
    subject: "Stand up development of the project.",
    at: AT,
    snippet: undefined,
    awaitingWords: true,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Stand up development of the project.",
    ...overrides,
  });
  // HQ's last word of the same row: at rest, its line held.
  const remembered = reading({
    kind: "idle",
    face: "idle",
    remembered: true,
  });

  it.each([
    {
      case: "connected, at its stand-up: the face works, and the line says it sets up",
      connected: true,
      activity: reading(),
      face: "working",
      reply: { kind: "live", words: "Setting up development" },
    },
    {
      case: "its socket blinking (reconnecting): still read live, the face still works",
      connected: false,
      activity: reading(),
      face: "working",
      reply: { kind: "live", words: "Setting up development" },
    },
    {
      case: "remembered, not connected: asleep, and its line held without claiming a reply",
      connected: false,
      activity: remembered,
      face: "sleep",
      reply: { kind: "held" },
    },
    {
      case: "remembered while connected, its conversation not read yet: idle, the line held",
      connected: true,
      activity: remembered,
      face: "idle",
      reply: { kind: "held" },
    },
    {
      case: "nothing read, connected: idle and no lines",
      connected: true,
      activity: undefined,
      face: "idle",
      reply: undefined,
    },
    {
      case: "nothing read, not connected: asleep and no lines",
      connected: false,
      activity: undefined,
      face: "sleep",
      reply: undefined,
    },
  ] as const)("$case", ({ connected, activity, face, reply }) => {
    const view = mateRowReading({ connected, activity, mine: true });
    expect(view.face).toBe(face);
    expect(view.reply).toEqual(reply);
  });

  // Its own change waiting on the person's review (`mateNextStep`, the composer's top) is the
  // same fact on the row: the needs-you face and the amber dot, wherever the Mate is not at work.
  it.each([
    {
      case: "at rest, its change waits: needs you",
      connected: true,
      activity: reading({ kind: "idle", face: "idle" }),
      state: "needs",
      face: "needs",
      dot: "attention",
    },
    {
      case: "finished unseen, its change waits: needs you before unread",
      connected: true,
      activity: reading({ kind: "idle", face: "done", unread: true }),
      state: "needs",
      face: "needs",
      dot: "attention",
    },
    {
      case: "at work, its change waits: the work shows",
      connected: true,
      activity: reading(),
      state: "working",
      face: "working",
      dot: undefined,
    },
    {
      case: "nothing read yet, its change waits: needs you",
      connected: true,
      activity: undefined,
      state: "needs",
      face: "needs",
      dot: "attention",
    },
    {
      case: "not connected, its change waits: the review still waits on you",
      connected: false,
      activity: remembered,
      state: "needs",
      face: "needs",
      dot: "attention",
    },
    {
      // Paused at its usage limit it sleeps, whatever its last turn said; the review stays on
      // its change's row under it.
      case: "paused at its usage limit, its change waits: paused",
      connected: true,
      activity: reading({
        kind: "failed",
        face: "sleep",
        pausedUntil: "2026-09-29T23:00:00.000Z",
      }),
      state: "paused",
      face: "sleep",
      dot: "attention",
    },
    {
      case: "stopped on an error, its change waits: the error shows",
      connected: true,
      activity: reading({ kind: "failed", face: "idle" }),
      state: "failed",
      face: "idle",
      dot: "failed",
    },
  ] as const)("$case", ({ connected, activity, state, face, dot }) => {
    const view = mateRowReading({ connected, activity, reviewWaits: true, mine: true });
    expect({ state: view.state, face: view.face, dot: view.dot }).toEqual({ state, face, dot });
  });

  // Another's Mate waits on its owner (the owner, 2026-09-30): no needs face, no amber dot,
  // its question said at rest as its last words; its own a viewer's needs them.
  it.each([
    {
      case: "own Mate asking",
      mine: true,
      review: false,
      state: "needs",
      face: "needs",
      dot: "attention",
      reply: { kind: "words", text: "Which port?", tone: "ink" },
    },
    {
      case: "another's Mate asking",
      mine: false,
      review: false,
      state: "idle",
      face: "idle",
      dot: undefined,
      reply: { kind: "words", text: "Which port?", tone: "muted" },
    },
    {
      case: "another's Mate, its change waiting",
      mine: false,
      review: true,
      state: "idle",
      face: "idle",
      dot: undefined,
      reply: { kind: "words", text: "Which port?", tone: "muted" },
    },
  ] as const)(
    "waits on the viewer only when it is theirs: $case",
    ({ mine, review, state, face, dot, reply }) => {
      const view = mateRowReading({
        connected: true,
        activity: reading({ kind: "input", face: "needs", question: "Which port?" }),
        reviewWaits: review,
        mine,
      });
      expect({ state: view.state, face: view.face, dot: view.dot, reply: view.reply }).toEqual({
        state,
        face,
        dot,
        reply,
      });
    },
  );

  it("never draws the working dots under an asleep face", () => {
    for (const connected of [true, false]) {
      for (const activity of [reading(), remembered, undefined]) {
        const view = mateRowReading({ connected, activity, mine: true });
        if (view.face === "sleep") expect(view.reply?.kind).not.toBe("pending");
      }
    }
  });
});

// A Mate still coming up is no ordinary row (the owner, 2026-09-29: "on the left it looks like
// its ready to be opened, but it's not"): its face in the coming pose, the projects page's words
// in its line, nothing that only a Mate that is up has.
describe("mateComingRowView — a Mate coming up, or one that did not come", () => {
  const view = mateRowView(undefined, "sleep");
  it.each([
    {
      case: "coming up: waking, no time, no dot",
      coming: { kind: "coming", line: "Coming up. A few minutes." },
      face: "waking",
      dot: undefined,
    },
    {
      case: "not created: asleep, the attention dot",
      coming: { kind: "failed", line: "Could not be created.", verb: "remove" },
      face: "sleep",
      dot: "attention",
    },
  ] as const)("$case", ({ coming, face, dot }) => {
    expect(mateComingRowView(view, coming)).toMatchObject({
      face,
      slot: { kind: "none" },
      dot,
      strongName: false,
      ask: undefined,
      reply: undefined,
      coming,
    });
  });
});

// The pose its face wears in the row (`mateFaceFor`): waking while it arrives — from its press
// until its first sign-in, inside its window — its conversation's own after (run 6).
describe("mateRowReading — the pose a Mate's row wears", () => {
  const activity = (overrides: Partial<ZeropsAgentActivity>): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "working",
    status: null,
    face: "working",
    subject: "Speed up the photo gallery",
    at: "2026-10-03T10:00:00.000Z",
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
    ...overrides,
  });
  it("an automated Mate free for a task rests on its row, its last task's end on its line alone", () => {
    const done = activity({ kind: "done", face: "done", snippet: "Opened a change." });
    expect(mateRowReading({ connected: true, activity: done, mine: true, free: true }).face).toBe(
      "idle",
    );
    expect(mateRowReading({ connected: true, activity: done, mine: true }).face).toBe("done");
  });
  it.each([
    {
      case: "arriving, up, its sign-in to come",
      connected: true,
      read: undefined,
      arriving: true,
      face: "waking",
    },
    {
      case: "arriving, its socket not up yet",
      connected: false,
      read: undefined,
      arriving: true,
      face: "waking",
    },
    {
      case: "arriving, at work",
      connected: true,
      read: activity({ face: "working" }),
      arriving: true,
      face: "working",
    },
    { case: "arrived, at rest", connected: true, read: undefined, arriving: false, face: "idle" },
    {
      case: "arrived, not running",
      connected: false,
      read: undefined,
      arriving: false,
      face: "sleep",
    },
  ] as const)("$case: $face", ({ connected, read, arriving, face }) => {
    expect(
      mateRowReading({ connected, activity: read, mine: false, pose: { arriving } }).face,
    ).toBe(face);
  });

  it("goes to sleep while it is deleted, whatever it was", () => {
    const view = mateRowReading({
      connected: true,
      activity: activity({ face: "working" }),
      mine: true,
      pose: { arriving: true },
    });
    expect(mateDeletingView(view).face).toBe("sleep");
  });
});

// A Mate being born, in its row's one line (board D1, 2026-09-30): coming up on a clock that
// counts from the press — "Almost there." included, the clock running on — a step past its cap
// saying so on the same clock, and any step that stopped the one fact, red. The Mate's own view
// says where it stands and why; the row only that it is on its way, or stopped.
describe("mateBornLine — a Mate being born, as its row's one line", () => {
  const SINCE = Date.parse("2026-09-30T10:00:00.000Z");
  it.each([
    {
      case: "coming up: the clock from the press",
      coming: { kind: "coming", line: "Coming up. A few minutes.", since: SINCE },
      nowMs: SINCE + 42_000,
      text: "Coming up · 0:42",
      tone: "muted",
    },
    {
      case: "its Mate waited on: still coming up, the clock running on",
      coming: { kind: "coming", line: "Almost there.", since: SINCE },
      nowMs: SINCE + 92_000,
      text: "Coming up · 1:32",
      tone: "muted",
    },
    {
      case: "a clock not started yet reads 0:00, never a negative",
      coming: { kind: "coming", line: "Coming up. A few minutes.", since: SINCE },
      nowMs: SINCE - 800,
      text: "Coming up · 0:00",
      tone: "muted",
    },
    {
      case: "coming up with no birth held in this browser: no clock to count",
      coming: { kind: "coming", line: "Coming up. A few minutes." },
      nowMs: SINCE,
      text: "Coming up",
      tone: "muted",
    },
    {
      case: "a step after the platform took it stopped",
      coming: {
        kind: "failed",
        line: "Could not be set up. The agent container could not be imported.",
        verb: "remove",
      },
      nowMs: SINCE,
      text: "Setting up stopped",
      tone: "attention",
    },
    {
      case: "the platform refused it",
      coming: { kind: "failed", line: "Could not be created.", verb: "remove" },
      nowMs: SINCE,
      text: "Setting up stopped",
      tone: "attention",
    },
    {
      case: "a New project's step stopped before the platform took anything",
      coming: { kind: "failed", line: "Git hosting could not be set up.", verb: "try-again" },
      nowMs: SINCE,
      text: "Setting up stopped",
      tone: "attention",
    },
  ] as const)("$case", ({ coming, nowMs, text, tone }) => {
    const line = mateBornLine(coming);
    expect(mateBornLineText(line, nowMs)).toBe(text);
    expect(line.tone).toBe(tone);
  });

  it("keeps its words while its clock ticks, so only a new step's words rise", () => {
    const coming = {
      kind: "coming",
      line: "Almost there.",
      since: SINCE,
    } as const;
    expect(mateBornLine(coming).words).toBe("Coming up");
    expect(mateBornLine({ ...coming, line: "Coming up. A few minutes." }).words).toBe("Coming up");
  });
});

// A creation the listing does not hold yet, drawn from its birth (`ZeropsGroupPendingMember`),
// reads as a listed Mate coming up does: on the clock from when the platform took it — a New
// project's from its press — or stopped.
describe("pendingBornLine — a Mate the listing does not hold yet", () => {
  const MEMBER = { startedAt: 1_000 } as const;
  it.each([
    { case: "on its way", member: MEMBER, text: "Coming up · 0:42", tone: "muted" },
    {
      case: "stopped",
      member: { ...MEMBER, failed: true },
      text: "Setting up stopped",
      tone: "attention",
    },
  ] as const)("$case", ({ member, text, tone }) => {
    const line = pendingBornLine(member);
    expect(mateBornLineText(line, 43_000)).toBe(text);
    expect(line.tone).toBe(tone);
  });
});

describe("ownerBadge — what the corner of a Mate's face wears", () => {
  const person = {
    kind: "person",
    mark: { label: "Jan's Mate", initial: "J", hue: 210, picture: null },
  } as const;
  const nobody = { kind: "nobody", label: "No owner yet." } as const;
  const unnamed = { kind: "unnamed" } as const;
  it.each([
    ["a colleague's Mate: their picture", person, false, person],
    ["the viewer's own Mate: nothing", person, true, null],
    ["a Mate nobody signed in: the empty seat", nobody, false, nobody],
    ["an owner not named yet: nothing, it may be the viewer's", unnamed, false, null],
  ] as const)("%s", (_name, seat, isViewer, wears) => {
    expect(ownerBadge(seat, isViewer)).toEqual(wears);
  });
});

describe("mateNotYours — whether a Mate's face is paler under its owner's badge", () => {
  const person = {
    kind: "person",
    mark: ownerMark({ name: "Jan", initials: "J", avatarUrl: null }),
  } as const;
  it.each([
    {
      name: "a colleague's",
      seat: person,
      isViewer: false,
      signer: "u-jan",
      viewer: "u-eva",
      pale: true,
    },
    {
      name: "the viewer's own",
      seat: person,
      isViewer: true,
      signer: "u-eva",
      viewer: "u-eva",
      pale: false,
    },
    {
      name: "nobody's",
      seat: { kind: "nobody", label: "" },
      isViewer: false,
      signer: undefined,
      viewer: "u-eva",
      pale: true,
    },
    {
      name: "unnamed, signed by somebody else",
      seat: { kind: "unnamed" },
      isViewer: false,
      signer: "u-jan",
      viewer: "u-eva",
      pale: true,
    },
    {
      name: "unnamed, signed by the viewer",
      seat: { kind: "unnamed" },
      isViewer: false,
      signer: "u-eva",
      viewer: "u-eva",
      pale: false,
    },
    {
      name: "unnamed, whose unknown",
      seat: { kind: "unnamed" },
      isViewer: false,
      signer: undefined,
      viewer: "u-eva",
      pale: false,
    },
  ] as const)("$name", ({ seat, isViewer, signer, viewer, pale }) => {
    expect(mateNotYours({ seat, isViewer, signer, viewer })).toBe(pale);
  });
});

describe("mateRowDraft — a Mate's unsent message, wherever its composer keeps it", () => {
  const ENV = "env-milo";
  const session = (
    threadId: string,
    overrides: { environmentId?: string; createdAt?: string; promotedTo?: unknown } = {},
  ) => ({
    environmentId: ENV,
    threadId,
    createdAt: "2026-09-30T20:00:00.000Z",
    ...overrides,
  });

  it.each([
    {
      case: "its conversation's own draft",
      source: { drafts: { "env-milo:thread-1": "also check the thumbnails" }, sessions: {} },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: "also check the thumbnails",
    },
    {
      case: "nothing typed",
      source: { drafts: { "env-milo:thread-1": "" }, sessions: {} },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: undefined,
    },
    {
      case: "only blanks typed",
      source: { drafts: { "env-milo:thread-1": "  \n " }, sessions: {} },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: undefined,
    },
    {
      case: "its words, trimmed",
      source: { drafts: { "env-milo:thread-1": "  deploy it \n" }, sessions: {} },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: "deploy it",
    },
    {
      case: "no conversation yet: the new one's draft in its environment",
      source: {
        drafts: { "draft-a": "set up a staging" },
        sessions: { "draft-a": session("t-a") },
      },
      mate: { environmentId: ENV },
      draft: "set up a staging",
    },
    {
      case: "no conversation yet: another environment's draft is not its own",
      source: {
        drafts: { "draft-a": "set up a staging" },
        sessions: { "draft-a": session("t-a", { environmentId: "env-other" }) },
      },
      mate: { environmentId: ENV },
      draft: undefined,
    },
    {
      case: "no conversation yet: a draft already sent is not unsent",
      source: {
        drafts: { "draft-a": "set up a staging" },
        sessions: { "draft-a": session("t-a", { promotedTo: { threadId: "t-a" } }) },
      },
      mate: { environmentId: ENV },
      draft: undefined,
    },
    {
      case: "no conversation yet: the newest draft with words",
      source: {
        drafts: { "draft-a": "older words", "draft-b": "newer words", "draft-c": "" },
        sessions: {
          "draft-a": session("t-a", { createdAt: "2026-09-30T20:00:00.000Z" }),
          "draft-b": session("t-b", { createdAt: "2026-09-30T21:00:00.000Z" }),
          "draft-c": session("t-c", { createdAt: "2026-09-30T22:00:00.000Z" }),
        },
      },
      mate: { environmentId: ENV },
      draft: "newer words",
    },
    {
      case: "a conversation: a new chat's draft beside it is not its own",
      source: { drafts: { "draft-a": "a side question" }, sessions: { "draft-a": session("t-a") } },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: undefined,
    },
    {
      case: "a conversation made from a draft: the draft still kept under the draft's key",
      source: {
        drafts: { "draft-a": "and the logo" },
        sessions: { "draft-a": session("thread-1") },
      },
      mate: { environmentId: ENV, threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: "and the logo",
    },
    {
      case: "not connected: its remembered conversation's draft, read from this browser",
      source: { drafts: { "env-milo:thread-1": "also check the thumbnails" }, sessions: {} },
      mate: { threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: "also check the thumbnails",
    },
    {
      case: "not connected: its remembered conversation, made from a draft",
      source: {
        drafts: { "draft-a": "and the logo" },
        sessions: { "draft-a": session("thread-1") },
      },
      mate: { threadId: "thread-1", threadKey: "env-milo:thread-1" },
      draft: "and the logo",
    },
    {
      case: "not connected: nowhere to look",
      source: {
        drafts: { "draft-a": "set up a staging" },
        sessions: { "draft-a": session("t-a") },
      },
      mate: {},
      draft: undefined,
    },
  ])("$case", ({ source, mate, draft }) => {
    const drafts = Object.fromEntries(
      Object.entries(source.drafts).map(([key, prompt]) => [key, { prompt }]),
    );
    expect(
      mateRowDraft({ draftsByThreadKey: drafts, draftThreadsByThreadKey: source.sessions }, mate),
    ).toBe(draft);
  });
});

describe("mateRowAskLine — the row's second line: what the person asked, or is about to", () => {
  const ASK = "Speed up the photo gallery";
  const WORDS = { kind: "words", text: "Thumbnails load lazily now.", tone: "muted" } as const;
  const COMING = { kind: "coming", verb: "wait", since: 0 } as unknown as MateComing;
  const base = {
    view: { ask: undefined, reply: undefined, coming: undefined },
    signIn: undefined,
    draft: undefined,
    sent: undefined,
    deleting: false,
    finishing: false,
    read: true,
    asker: undefined,
  };

  it.each([
    {
      case: "no messages, its conversations read: nothing asked yet",
      input: base,
      line: { kind: "nothing-asked" },
    },
    {
      // Live, 2026-10-02: the row read Draft → "Nothing asked yet" → the task, for 0.4 s.
      case: "no messages, a message just sent: the sent message, never nothing asked",
      input: { ...base, sent: "Build a minimal todo app" },
      line: { kind: "ask", text: "Build a minimal todo app", by: "You" },
    },
    {
      case: "asked before, a message just sent: the sent message over the old ask",
      input: {
        ...base,
        view: { ask: ASK, reply: WORDS, coming: undefined },
        sent: "and the logo",
      },
      line: { kind: "ask", text: "and the logo", by: "You" },
    },
    {
      case: "a message just sent, then a draft typed: the draft",
      input: { ...base, sent: "Build a minimal todo app", draft: "and dark mode" },
      line: { kind: "draft", text: "and dark mode", ask: undefined },
    },
    {
      case: "no messages, its conversations not read yet: nothing painted to take back",
      input: { ...base, read: false },
      line: undefined,
    },
    {
      case: "no messages, a draft: the draft",
      input: { ...base, draft: "set up a staging" },
      line: { kind: "draft", text: "set up a staging", ask: undefined },
    },
    {
      case: "no messages, not read, a draft: the draft is this browser's own",
      input: { ...base, read: false, draft: "set up a staging" },
      line: { kind: "draft", text: "set up a staging", ask: undefined },
    },
    {
      case: "asked and answered: the ask",
      input: { ...base, view: { ask: ASK, reply: WORDS, coming: undefined } },
      line: { kind: "ask", text: ASK },
    },
    {
      case: "asked and answered, a draft: the draft over the ask",
      input: {
        ...base,
        view: { ask: ASK, reply: WORDS, coming: undefined },
        draft: "and the logo",
      },
      line: { kind: "draft", text: "and the logo", ask: ASK },
    },
    {
      case: "running, a draft: the draft over the ask, the live step below keeps its place",
      input: {
        ...base,
        view: { ask: ASK, reply: { kind: "pending" } as const, coming: undefined },
        draft: "and the logo",
      },
      line: { kind: "draft", text: "and the logo", ask: ASK },
    },
    {
      case: "running, no draft: the ask",
      input: {
        ...base,
        view: { ask: ASK, reply: { kind: "pending" } as const, coming: undefined },
      },
      line: { kind: "ask", text: ASK },
    },
    {
      case: "setting up, nothing the person asked: its step says it below",
      input: {
        ...base,
        view: {
          ask: undefined,
          reply: { kind: "live", words: "Setting up development" } as const,
          coming: undefined,
        },
      },
      line: undefined,
    },
    {
      case: "nobody signed in: the sign-in, whatever is typed",
      input: {
        ...base,
        signIn: { text: "Waiting for your sign-in", waitsOnViewer: true },
        draft: "hello",
      },
      line: { kind: "sign-in", text: "Waiting for your sign-in", waitsOnViewer: true },
    },
    {
      case: "coming up: its born line says it",
      input: { ...base, view: { ask: undefined, reply: undefined, coming: COMING }, draft: "hi" },
      line: undefined,
    },
    {
      case: "deleting, asked: the ask, and no draft waits on it",
      input: {
        ...base,
        view: { ask: ASK, reply: undefined, coming: undefined },
        deleting: true,
        draft: "hi",
      },
      line: { kind: "ask", text: ASK },
    },
    {
      case: "deleting, never asked: its deleting line says it",
      input: { ...base, deleting: true },
      line: undefined,
    },
    {
      // Live, 2026-10-02: Finish setup on a Mate waiting for its sign-in, and its row said nothing.
      case: "finishing its setup, waiting for a sign-in: its finishing line in the sign-in's place",
      input: {
        ...base,
        finishing: true,
        signIn: { text: "Nobody has signed in yet", waitsOnViewer: false },
      },
      line: undefined,
    },
    {
      case: "finishing its setup, asked: the ask, and no draft waits on it",
      input: {
        ...base,
        view: { ask: ASK, reply: undefined, coming: undefined },
        finishing: true,
        draft: "hi",
      },
      line: { kind: "ask", text: ASK },
    },
  ])("$case", ({ input, line }) => {
    expect(mateRowAskLine(input)).toEqual(line);
  });

  // The owner, 2026-10-11, of a row reading "continue" over its answer: a line of the person's
  // words with nobody's name on it read like a label.
  it.each([
    {
      case: "on the viewer's own Mate: theirs, as You",
      input: { ...base, view: { ask: ASK, reply: WORDS, coming: undefined }, asker: "You" },
      line: { kind: "ask", text: ASK, by: "You" },
    },
    {
      case: "on a colleague's: their person's, by first name",
      input: { ...base, view: { ask: ASK, reply: WORDS, coming: undefined }, asker: "Jan" },
      line: { kind: "ask", text: ASK, by: "Jan" },
    },
    {
      case: "whose Mate HQ has not named yet: nobody's",
      input: { ...base, view: { ask: ASK, reply: WORDS, coming: undefined } },
      line: { kind: "ask", text: ASK },
    },
    {
      case: "just sent from this browser, its owner not named yet: the viewer's",
      input: { ...base, sent: "and the logo" },
      line: { kind: "ask", text: "and the logo", by: "You" },
    },
    {
      case: "deleting: its person's still",
      input: {
        ...base,
        view: { ask: ASK, reply: undefined, coming: undefined },
        deleting: true,
        asker: "Jan",
      },
      line: { kind: "ask", text: ASK, by: "Jan" },
    },
  ])("says whose words the ask is: $case", ({ input, line }) => {
    expect(mateRowAskLine(input)).toEqual(line);
  });

  // Milo's stress run 6: the row's text held the raw "`sleep 20 && …`" of a message just sent.
  it.each([
    {
      case: "a message just sent",
      input: { ...base, sent: "Start a job (`sleep 20 && echo done`) **now**" },
      line: { kind: "ask", text: "Start a job (sleep 20 && echo done) now", by: "You" },
    },
    {
      case: "a draft",
      input: { ...base, draft: "Start a job (`sleep 20 && echo done`) **now**" },
      line: { kind: "draft", text: "Start a job (sleep 20 && echo done) now", ask: undefined },
    },
  ])("the person's line says their words as plain words: $case", ({ input, line }) => {
    expect(mateRowAskLine(input)).toEqual(line);
  });
});

// Only its owner talks to a Mate (D5), so the person who asked is its owner.
describe("mateAsker — who a row says asked its Mate", () => {
  it.each([
    { case: "the viewer's own Mate", owner: { name: "Petra Malá", isViewer: true }, by: "You" },
    { case: "a colleague's", owner: { name: "Jan Novák", isViewer: false }, by: "Jan" },
    {
      case: "a colleague named by one word",
      owner: { name: "Alex", isViewer: false },
      by: "Alex",
    },
    {
      case: "a colleague HQ names without a name",
      owner: { name: "  ", isViewer: false },
      by: undefined,
    },
    { case: "an owner HQ has not named", owner: undefined, by: undefined },
  ])("$case: $by", ({ owner, by }) => {
    expect(mateAsker(owner)).toBe(by);
  });
});

// A row whose setup stopped offers its menu — *Finish setup* is on it — while one still coming
// offers none (live, 2026-10-01: a half-made Mate's row read "Setting up stopped" with no ⋯).
describe("mateRowOffersMenu", () => {
  it.each([
    { case: "a Mate that is up", deleting: false, coming: undefined, want: true },
    { case: "a Mate going", deleting: true, coming: undefined, want: false },
    {
      case: "a Mate still coming",
      deleting: false,
      coming: { kind: "coming", line: "Coming up" } satisfies MateComing,
      want: false,
    },
    {
      case: "a Mate whose setup stopped",
      deleting: false,
      coming: {
        kind: "failed",
        line: "Its setup stopped.",
        verb: "finish-setup",
      } satisfies MateComing,
      want: true,
    },
  ])("$case: $want", ({ deleting, coming, want }) => {
    expect(mateRowOffersMenu({ deleting, coming })).toBe(want);
  });
});

describe("mateRowPropsEqual — when a memoised row may skip its redraw", () => {
  const select = () => {};
  const activity = { threadId: ThreadId.make("t1"), kind: "working" } as ZeropsAgentActivity;
  const base = {
    active: false,
    activity,
    owner: { name: "Ales", initials: "A", avatarUrl: null, isViewer: true },
    coming: undefined as MateComing | undefined,
    onSelect: select,
    number: 1,
  };

  it.each<[string, Partial<typeof base>, boolean]>([
    ["nothing changed", {}, true],
    ["its owner read again, the same", { owner: { ...base.owner } }, true],
    ["its coming read again, the same", { coming: undefined }, true],
    ["it became the open one", { active: true }, false],
    ["its activity changed", { activity: { ...activity, kind: "idle" } }, false],
    ["its activity is a new object, the same", { activity: { ...activity } }, false],
    ["its owner changed", { owner: { ...base.owner, name: "Jan" } }, false],
    [
      "it started coming up",
      { coming: { kind: "coming", line: "Starting its container" } as MateComing },
      false,
    ],
    ["its verb changed", { onSelect: () => {} }, false],
    ["its number changed", { number: 2 }, false],
  ])("%s → equal: %s", (_, change, equal) => {
    expect(mateRowPropsEqual(base, { ...base, ...change })).toBe(equal);
  });

  it("redraws for a prop it no longer has", () => {
    const { number: _number, ...rest } = base;
    expect(mateRowPropsEqual(base, rest)).toBe(false);
  });
});

import { mateComing } from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  selectReachability,
} from "@t3tools/client-runtime/zerops/environments";

it("a connected machine keeps the row menu available while its listing still provisions", () => {
  const environmentId = EnvironmentId.make("row-env");
  const machine = {
    ...initialEnvironment({ record: environmentId }),
    container: { level: "ready" } as const,
    presence: { kind: "present", origin: "https://mate.test" } as const,
    credential: {
      kind: "held",
      environmentId,
      installed: true,
      staleBlock: false,
      rereading: null,
    } as const,
    link: { phase: "connected", since: { wall: 100, mono: 100 } } as const,
  };
  const input = {
    press: undefined,
    candidate: { group: "provisioning", service: { status: "CREATING" } } as const,
    link: {
      key: "p:s",
      environmentId,
      reachability: selectReachability(machine, environmentId),
      answered: true,
      failuresSinceConnect: 0,
      errorsSinceConnect: 0,
    },
  };
  expect(mateRowOffersMenu({ deleting: false, coming: mateComing(input) })).toBe(true);
});

describe("mateRowSecond — the one line under a Mate's name", () => {
  const view = (
    state: MateRowView["state"],
    reply: MateRowView["reply"] | null = { kind: "words", text: "Its last words.", tone: "muted" },
    slot: MateRowView["slot"] = { kind: "age" },
  ) => ({ state, reply: reply ?? undefined, slot });
  const second = (over: Partial<Parameters<typeof mateRowSecond>[0]> = {}) =>
    mateRowSecond({
      view: view("idle"),
      askLine: { kind: "ask", text: "Add a search box" },
      deleting: false,
      finishing: false,
      outsideHq: false,
      mine: true,
      waitsOn: undefined,
      change: undefined,
      ...over,
    });

  it.each([
    { case: "at rest: its last words, muted", over: {}, line: { kind: "reply", tone: "muted" } },
    {
      case: "finished and unseen: its last words in ink, beside the unread dot",
      over: { view: view("unread", { kind: "words", text: "Done.", tone: "ink-2" }) },
      line: { kind: "reply", tone: "ink" },
    },
    {
      case: "working: its step",
      over: { view: view("working", { kind: "live", words: "Running the tests" }) },
      line: { kind: "reply", tone: undefined },
    },
    {
      case: "a question or plan for the viewer: in ink",
      over: { view: view("needs", { kind: "words", text: "Go ahead?", tone: "ink" }) },
      line: { kind: "reply", tone: "ink" },
    },
    {
      case: "a colleague's Mate waiting on its person: who it waits on",
      over: { mine: false, waitsOn: "Alex" },
      line: { kind: "waits-on", text: "Waits on Alex" },
    },
    {
      case: "the viewer's own failure: the fail colour",
      over: { view: view("failed", { kind: "words", text: "Build failed.", tone: "failed" }) },
      line: { kind: "reply", tone: "failed" },
    },
    {
      case: "a colleague's failure: muted",
      over: {
        mine: false,
        view: view("failed", { kind: "words", text: "Build failed.", tone: "failed" }),
      },
      line: { kind: "reply", tone: "muted" },
    },
    {
      case: "at its limit: when it picks up",
      over: {
        view: view("paused", undefined, { kind: "paused", until: "2026-10-10T13:00:00Z" }),
      },
      line: { kind: "paused", until: "2026-10-10T13:00:00Z" },
    },
    {
      case: "its change waits on the viewer: the change, in ink",
      over: { change: { title: "Cart page with saved items", mine: true } },
      line: { kind: "change", title: "Cart page with saved items", mine: true },
    },
    {
      case: "its change outranks a sign-in its records still ask for",
      over: {
        askLine: { kind: "sign-in", text: "Waiting for sign-in", waitsOnViewer: false },
        change: { title: "Cart page", mine: true },
      },
      line: { kind: "change", title: "Cart page", mine: true },
    },
    {
      case: "a question outranks its change",
      over: {
        view: view("needs", { kind: "words", text: "Go ahead?", tone: "ink" }),
        asks: true,
        change: { title: "Cart page", mine: true },
      },
      line: { kind: "reply", tone: "ink" },
    },
    {
      case: "needing the viewer only for its change: the change",
      over: { view: view("needs"), change: { title: "Cart page", mine: true } },
      line: { kind: "change", title: "Cart page", mine: true },
    },
    {
      case: "a colleague's open change: in review, muted",
      over: { mine: false, change: { title: "Rate limit the public API", mine: false } },
      line: { kind: "change", title: "Rate limit the public API", mine: false },
    },
    {
      case: "several open changes: how many",
      over: { view: view("needs"), change: { title: "Cart page", mine: true, count: 2 } },
      line: { kind: "change", title: "Cart page", mine: true, count: 2 },
    },
    {
      case: "an unsent draft over its last words",
      over: { askLine: { kind: "draft", text: "also count", ask: undefined } },
      line: { kind: "ask", pending: false },
    },
    {
      case: "no words yet: what was asked",
      over: { view: view("idle", null) },
      line: { kind: "ask", pending: false },
    },
    {
      case: "working with no step relayed: what it is on, and the dots",
      over: { view: view("working", { kind: "pending" }) },
      line: { kind: "ask", pending: true },
    },
    {
      case: "working outranks a sign-in its records still ask for",
      over: {
        view: view("working", { kind: "live", words: "Setting up development" }),
        askLine: { kind: "sign-in", text: "Waiting for sign-in", waitsOnViewer: false },
      },
      line: { kind: "reply", tone: undefined },
    },
    {
      case: "what HQ last said of it outranks the sign-in",
      over: {
        view: view("idle", { kind: "words", text: "Last known…", tone: "muted", lastKnown: true }),
        askLine: { kind: "sign-in", text: "Waiting for sign-in", waitsOnViewer: false },
      },
      line: { kind: "reply", tone: "muted" },
    },
    {
      case: "nobody signed in: the sign-in",
      over: { askLine: { kind: "sign-in", text: "Waiting for your sign-in", waitsOnViewer: true } },
      line: { kind: "sign-in" },
    },
    {
      case: "nothing at all",
      over: { view: view("idle", null), askLine: undefined },
      line: { kind: "none" },
    },
    { case: "on its way off Zerops", over: { deleting: true }, line: { kind: "deleting" } },
    { case: "its setup being finished", over: { finishing: true }, line: { kind: "finishing" } },
    { case: "outside this HQ", over: { outsideHq: true }, line: { kind: "outside" } },
  ] as const)("$case", ({ over, line }) => {
    expect(second(over as Partial<Parameters<typeof mateRowSecond>[0]>)).toEqual(line);
  });
});

describe("tasksWaitingWords — the tasks waiting for an application's Mates", () => {
  it.each([
    [0, undefined],
    [-1, undefined],
    [1, "1 task waiting"],
    [3, "3 tasks waiting"],
  ] as const)("%i waiting reads %s", (waiting, words) => {
    expect(tasksWaitingWords(waiting)).toBe(words);
  });
});

describe("mateAutomation — an automated Mate as its HQ record says it", () => {
  it.each([
    { case: "an ordinary Mate", mate: { face: "" }, expected: undefined },
    { case: "no record yet", mate: undefined, expected: undefined },
    { case: "automated, no task", mate: { automated: true }, expected: { task: null } },
    {
      case: "automated, on a task",
      mate: {
        automated: true,
        task: { id: "t1", repo: "acme/tea-shop", number: 12, title: "Fix it", url: "u" },
      },
      expected: { task: { number: 12, title: "Fix it" } },
    },
    {
      case: "automated, on a task from Slack that waits for a person's answer",
      mate: {
        automated: true,
        task: { id: "t2", title: "Update the price list", url: null, waiting: true as const },
      },
      expected: { task: { title: "Update the price list", waiting: true } },
    },
    {
      case: "automated, on a task whose change is a pull request on GitHub",
      mate: {
        automated: true,
        task: {
          id: "t3",
          repo: "acme/tea-shop",
          number: 1,
          title: "Add a search box",
          url: "u",
          pullRequest: { number: 2, url: "p", state: "open" as const, checks: "failing" as const },
        },
      },
      expected: {
        task: {
          number: 1,
          title: "Add a search box",
          pullRequest: { number: 2, state: "open", checks: "failing" },
        },
      },
    },
    {
      case: "automated, its most recent task ended: free for the next",
      mate: {
        automated: true,
        task: {
          id: "t4",
          number: 1,
          title: "Add a search box",
          url: "u",
          ended: "merged" as const,
          endedAt: "2026-10-17T09:00:00.000Z",
          pullRequest: { number: 2, url: "p", state: "merged" as const },
        },
      },
      expected: {
        task: null,
        last: {
          number: 1,
          title: "Add a search box",
          ended: "merged",
          endedAt: "2026-10-17T09:00:00.000Z",
        },
      },
    },
    {
      case: "automated, its most recent task stopped by HQ for the spent budget",
      mate: {
        automated: true,
        task: {
          id: "t5",
          title: "Prices per 100 g",
          url: null,
          ended: "stopped" as const,
          why: "budget" as const,
        },
      },
      expected: {
        task: null,
        last: { title: "Prices per 100 g", ended: "stopped", why: "budget" },
      },
    },
  ])("$case", ({ mate, expected }) => {
    expect(mateAutomation(mate)).toEqual(expected);
  });

  it("carries what is read of the organization's key to an automated Mate's line alone", () => {
    expect(mateAutomation({ automated: true }, "missing")).toEqual({ task: null, key: "missing" });
    expect(mateAutomation({ automated: false }, "missing")).toBeUndefined();
  });

  it("carries how many of an automated Mate's changes wait for review, where several do", () => {
    expect(mateAutomation({ automated: true }, undefined, 3)).toEqual({ task: null, inReview: 3 });
    expect(mateAutomation({ automated: true }, undefined, 1)).toEqual({ task: null });
  });
});

describe("mateRowTime — when a row dates its Mate", () => {
  const ended = "2026-10-17T09:00:00.000Z";
  const last = { title: "Prices per 100 g", ended: "merged" as const, endedAt: ended };
  it.each([
    {
      case: "a free automated Mate's row dates its last task's end in its time slot",
      input: {
        slot: { kind: "age" },
        at: "2026-10-17T11:00:00.000Z",
        automated: { task: null, last },
      },
      expected: { slot: { kind: "age" }, at: ended },
    },
    {
      case: "a free automated Mate with no conversation read yet still dates its last task's end",
      input: { slot: { kind: "none" }, at: undefined, automated: { task: null, last } },
      expected: { slot: { kind: "age" }, at: ended },
    },
    {
      case: "an automated Mate that never had a task shows no time",
      input: { slot: { kind: "age" }, at: "2026-10-17T11:00:00.000Z", automated: { task: null } },
      expected: { slot: { kind: "none" }, at: undefined },
    },
    {
      case: "an automated Mate at work keeps its run's clock",
      input: {
        slot: { kind: "clock", since: ended },
        at: ended,
        automated: { task: { title: "Prices per 100 g" } },
      },
      expected: { slot: { kind: "clock", since: ended }, at: ended },
    },
    {
      case: "any other Mate's row dates its own last word",
      input: { slot: { kind: "age" }, at: ended, automated: undefined },
      expected: { slot: { kind: "age" }, at: ended },
    },
  ] as const)("$case", ({ input, expected }) => {
    expect(mateRowTime(input)).toEqual(expected);
  });
});

describe("mateRowSecond — an automated Mate's line", () => {
  const view = (
    state: MateRowView["state"],
    reply: MateRowView["reply"] | null = { kind: "words", text: "Its last words.", tone: "muted" },
    slot: MateRowView["slot"] = { kind: "age" },
  ) => ({ state, reply: reply ?? undefined, slot });
  const task = { number: 12, title: "Fix the checkout total" };
  const second = (over: Partial<Parameters<typeof mateRowSecond>[0]> = {}) =>
    mateRowSecond({
      view: view("idle"),
      askLine: { kind: "ask", text: "Work issue #12 in the project, then open a change." },
      deleting: false,
      finishing: false,
      outsideHq: false,
      mine: true,
      waitsOn: undefined,
      change: undefined,
      automated: { task: null },
      ...over,
    });

  it.each([
    {
      case: "an automated Mate that never had a task says so",
      over: {},
      line: { kind: "task", text: "No tasks yet", on: false },
    },
    {
      case: "an automated Mate never asked anything yet says it has had no task",
      over: { view: view("idle", null), askLine: undefined },
      line: { kind: "task", text: "No tasks yet", on: false },
    },
    {
      case: "an idle automated Mate's row names its last task and how it ended",
      over: {
        automated: {
          task: null,
          last: { title: "Prices per 100 g", ended: "merged", endedAt: "2026-10-17T09:00:00Z" },
        },
      },
      line: { kind: "task", text: "Prices per 100 g · merged", on: false },
    },
    {
      case: "an idle automated Mate's last task from GitHub is named by its issue",
      over: {
        automated: {
          task: null,
          last: { number: 12, title: "Fix the checkout total", ended: "failed" },
        },
      },
      line: { kind: "task", text: "#12 Fix the checkout total · failed", on: false },
    },
    {
      case: "an idle automated Mate whose last task HQ stopped for the spent budget says so",
      over: {
        automated: {
          task: null,
          last: {
            title: "Prices per 100 g",
            ended: "stopped",
            why: "budget",
            endedAt: "2026-10-17T11:58:00Z",
          },
        },
      },
      line: { kind: "task", text: "Prices per 100 g · stopped: budget spent", on: false },
    },
    {
      case: "an automated Mate holding changes in review says how many, not its last task",
      over: {
        automated: {
          task: null,
          inReview: 2,
          last: { title: "Prices per 100 g", ended: "merged" },
        },
      },
      line: { kind: "task", text: "2 changes in review", on: false },
    },
    {
      case: "an automated Mate at work says its step, as any Mate",
      over: {
        automated: { task },
        view: view(
          "working",
          { kind: "live", words: "Running the tests" },
          {
            kind: "clock",
            since: "2026-10-17T10:00:00Z",
          },
        ),
      },
      // After the task it is on: an automated Mate's row names the work it does.
      line: { kind: "reply", tone: undefined, task: "#12 Fix the checkout total" },
    },
    {
      case: "an automated Mate at work without a step names its task, never its brief's words",
      over: { automated: { task }, view: view("working", { kind: "pending" }) },
      line: { kind: "task", text: "#12 Fix the checkout total · working", on: true },
    },
    {
      case: "an automated Mate at work without a task says its step, never that it waits for one",
      over: {
        view: view(
          "working",
          { kind: "live", words: "Standing up the project" },
          {
            kind: "clock",
            since: "2026-10-17T10:00:00Z",
          },
        ),
      },
      line: { kind: "reply", tone: undefined },
    },
    {
      case: "an automated Mate asking something says the question, as any Mate",
      over: {
        automated: { task },
        asks: true,
        view: view("needs", { kind: "words", text: "Which currency?", tone: "muted" }),
      },
      line: { kind: "reply", tone: "ink" },
    },
    {
      case: "an automated Mate whose finished task waits for review says so while it works on",
      over: {
        automated: { task: { ...task, done: true } },
        view: view("working", { kind: "pending" }),
      },
      line: { kind: "task", text: "#12 Fix the checkout total · up for review", on: false },
    },
    {
      case: "an automated Mate at rest on a task says the task waits for review",
      over: { automated: { task } },
      line: { kind: "task", text: "#12 Fix the checkout total · up for review", on: false },
    },
    {
      case: "an automated Mate at rest whose changes wait for review, one per task, says how many",
      over: { automated: { task: { ...task, done: true }, inReview: 2 } },
      line: { kind: "task", text: "2 changes in review", on: false },
    },
    {
      case: "an automated Mate at work on a task names it, whatever else of its waits for review",
      over: { automated: { task, inReview: 2 }, view: view("working", { kind: "pending" }) },
      line: { kind: "task", text: "#12 Fix the checkout total · working", on: true },
    },
    {
      case: "an automated Mate whose task's change waits on the viewer says so in ink",
      over: { automated: { task }, view: view("needs") },
      line: { kind: "task", text: "#12 Fix the checkout total · up for review", on: true },
    },
    {
      case: "an automated Mate whose task waits for a person's answer says it waits for you, in ink",
      over: {
        automated: { task: { ...task, waiting: true } },
        view: view("needs", { kind: "words", text: "Which currency?", tone: "muted" }),
      },
      line: { kind: "task", text: "#12 Fix the checkout total · waiting for you", on: true },
    },
    {
      case: "an automated Mate whose task waits for an answer says so once its words are read",
      over: { automated: { task: { ...task, waiting: true } }, view: view("unread") },
      line: { kind: "task", text: "#12 Fix the checkout total · waiting for you", on: true },
    },
    {
      case: "an automated Mate whose task waits for an answer but is at work again says its step",
      over: {
        automated: { task: { ...task, waiting: true } },
        view: view("working", { kind: "pending" }),
      },
      line: { kind: "task", text: "#12 Fix the checkout total · working", on: true },
    },
    {
      case: "an automated Mate whose finished task's pull request is open says it waits for review while it works on",
      over: {
        automated: { task: { ...task, done: true, pullRequest: { number: 14, state: "open" } } },
        view: view("working", { kind: "pending" }),
      },
      line: {
        kind: "task",
        text: "#12 Fix the checkout total · PR #14 up for review",
        on: false,
      },
    },
    {
      case: "an automated Mate at rest on a task whose pull request is open says it waits for review",
      over: { automated: { task: { ...task, pullRequest: { number: 14, state: "open" } } } },
      line: {
        kind: "task",
        text: "#12 Fix the checkout total · PR #14 up for review",
        on: false,
      },
    },
    {
      case: "an automated Mate whose pull request waits on the viewer says so in ink",
      over: {
        automated: {
          task: { ...task, pullRequest: { number: 14, state: "open", checks: "passing" } },
        },
        view: view("needs"),
      },
      line: {
        kind: "task",
        text: "#12 Fix the checkout total · PR #14 up for review",
        on: true,
      },
    },
    {
      case: "an automated Mate at rest whose pull request's checks fail says they fail, in ink",
      over: {
        automated: {
          task: { ...task, pullRequest: { number: 14, state: "open", checks: "failing" } },
        },
      },
      line: { kind: "task", text: "#12 Fix the checkout total · PR #14 checks failing", on: true },
    },
    {
      case: "an automated Mate at work on a task with an open pull request names both, never review",
      over: {
        automated: { task: { ...task, pullRequest: { number: 14, state: "open" } } },
        view: view("working", { kind: "pending" }),
      },
      line: {
        kind: "task",
        text: "#12 Fix the checkout total · working · PR #14 open",
        on: true,
      },
    },
    {
      case: "an automated Mate whose pull request merged says it merged",
      over: { automated: { task: { ...task, pullRequest: { number: 14, state: "merged" } } } },
      line: { kind: "task", text: "#12 Fix the checkout total · PR #14 merged", on: false },
    },
    {
      case: "an automated Mate whose pull request was closed unmerged says it closed",
      over: { automated: { task: { ...task, pullRequest: { number: 14, state: "closed" } } } },
      line: { kind: "task", text: "#12 Fix the checkout total · PR #14 closed", on: false },
    },
    {
      case: "an automated Mate whose task waits for an answer says so over its pull request",
      over: {
        automated: {
          task: { ...task, waiting: true, pullRequest: { number: 14, state: "open" } },
        },
        view: view("needs", { kind: "words", text: "Which currency?", tone: "muted" }),
      },
      line: { kind: "task", text: "#12 Fix the checkout total · waiting for you", on: true },
    },
    {
      case: "an automated Mate whose task HQ stops says it is stopping, at work or not",
      over: {
        automated: { task: { ...task, stopping: true } },
        view: view("working", { kind: "pending" }),
      },
      line: { kind: "task", text: "#12 Fix the checkout total · stopping", on: false },
    },
    {
      case: "an automated Mate on a task from elsewhere names it by its title",
      over: { automated: { task: { title: "Update the price list" } } },
      line: { kind: "task", text: "Update the price list · up for review", on: false },
    },
    {
      case: "an automated Mate at rest with no task and no organization key says it waits for the key",
      over: { automated: { task: null, key: "missing" } },
      line: { kind: "task", text: "Waiting for an API key", on: false },
    },
    {
      case: "an automated Mate on a task names it, whatever is read of the key",
      over: { automated: { task, key: "missing" }, view: view("working", { kind: "pending" }) },
      line: { kind: "task", text: "#12 Fix the checkout total · working", on: true },
    },
    {
      case: "an automated Mate whose key is not read yet never says it waits for the key",
      over: { automated: { task: null, key: "unknown" } },
      line: { kind: "task", text: "No tasks yet", on: false },
    },
    {
      case: "an automated Mate never offers a sign-in on its line",
      over: { askLine: { kind: "sign-in" } },
      line: { kind: "task", text: "No tasks yet", on: false },
    },
    {
      case: "an automated Mate that stopped on an error says the error",
      over: { view: view("failed", { kind: "words", text: "Build failed.", tone: "failed" }) },
      line: { kind: "reply", tone: "failed" },
    },
    {
      case: "an automated Mate at its key's limit says when it picks up",
      over: {
        view: view("paused", undefined, { kind: "paused", until: "2026-10-17T13:00:00Z" }),
      },
      line: { kind: "paused", until: "2026-10-17T13:00:00Z" },
    },
    {
      case: "an automated Mate on its way off Zerops says so",
      over: { automated: { task }, deleting: true },
      line: { kind: "deleting" },
    },
  ] as const)("$case", ({ over, line }) => {
    expect(second(over as Partial<Parameters<typeof mateRowSecond>[0]>)).toEqual(line);
  });
});

// A reload paints a row before its Mate's conversations are read: its line is held empty until
// what is read lands in it, so the rows under it never move (they moved 12 px at 0.5–0.75 s).
describe("mateRowHeldLines — the lines a row holds while a reload reads it", () => {
  it.each([
    {
      case: "an answer remembered, not read yet",
      second: { kind: "reply", tone: "muted" } as const,
      read: false,
      held: 0,
    },
    { case: "nothing known yet", second: { kind: "none" } as const, read: false, held: 1 },
    {
      case: "its conversations read",
      second: { kind: "reply", tone: "muted" } as const,
      read: true,
      held: 0,
    },
    { case: "a Mate still coming up", second: { kind: "coming" } as const, read: false, held: 0 },
  ])("holds $held for $case", ({ second, read, held }) => {
    expect(mateRowHeldLines({ second, read })).toBe(held);
  });
});

it("A sidebar Mate with no deployment says nothing is deployed rather than setup stopped", () => {
  const coming = mateComing({
    press: undefined,
    candidate: {
      group: "provisioning",
      service: { status: "READY_TO_DEPLOY", activeAppVersion: null },
    },
  });
  expect(coming).toBeDefined();
  if (coming === undefined) throw new Error("Missing deployment verdict");
  const view = mateComingRowView(mateRowView(undefined, "sleep"), coming);
  expect(view.coming).toEqual(coming);
  expect(mateBornLineText(mateBornLine(coming), 0)).toBe("Nothing is deployed yet.");
});

// Run 2: an automatic update restarted a Mate a second after its answer, and its row said at once
// that it "isn't answering since" then, "Last known: … had no active work". A restart that comes
// back within half a minute is not an outage.
describe("a Mate's row waits half a minute before it says the Mate isn't answering", () => {
  const OFF = "2026-10-16T10:00:00.000Z";
  const offMs = Date.parse(OFF);
  const told: ZeropsAgentActivity = {
    threadId: ThreadId.make("thread-1"),
    kind: "done",
    status: null,
    face: "done",
    subject: "Speed up the photo gallery",
    at: OFF,
    snippet: "Thumbnails load lazily now.",
    unread: true,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
  };
  const row = (nowMs: number) =>
    mateRowReading({
      name: "Nova",
      connected: false,
      activity: restingActivity(told),
      offlineSince: OFF,
      nowMs,
      mine: true,
    }).reply;

  it.each([1_000, 29_999])("%i ms after it went: its last words, no alarm", (after) => {
    expect(row(offMs + after)).toMatchObject({
      kind: "words",
      text: "Thumbnails load lazily now.",
    });
  });

  it("half a minute after it went: it isn't answering, and what was last known", () => {
    const reply = row(offMs + 30_000);
    expect(reply).toMatchObject({ kind: "words", lastKnown: true });
    expect(reply?.kind === "words" ? reply.text : "").toMatch(
      /^Nova isn't answering since .*Last known/,
    );
  });
});

// Parts-7 of the run 2 follow-up: an automatic update held a Mate's last words on its row for half
// a minute, as if nothing happened, then said it wasn't answering. The update is a fact the app
// holds (its link's verdict), so the row says it.
describe("a Mate's row says it is updating while its update restarts it", () => {
  const OFF = "2026-10-16T10:00:00.000Z";
  const offMs = Date.parse(OFF);
  const told: ZeropsAgentActivity = {
    threadId: ThreadId.make("thread-1"),
    kind: "done",
    status: null,
    face: "done",
    subject: "Speed up the photo gallery",
    at: OFF,
    snippet: "Thumbnails load lazily now.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
  };
  const row = (input: { nowMs: number; updating: boolean; connected: boolean }) =>
    mateRowReading({
      name: "Nova",
      connected: input.connected,
      activity: input.connected ? told : restingActivity(told),
      offlineSince: input.connected ? undefined : OFF,
      nowMs: input.nowMs,
      updating: input.updating,
      mine: true,
    }).reply;

  it.each([1_000, 45_000])("%i ms into its update: that it is updating, nothing else", (after) => {
    expect(row({ nowMs: offMs + after, updating: true, connected: false })).toEqual({
      kind: "words",
      text: "Updating to the new version",
      tone: "muted",
    });
  });

  it("once it answers again: its own words", () => {
    expect(row({ nowMs: offMs + 60_000, updating: false, connected: true })).toMatchObject({
      kind: "words",
      text: "Thumbnails load lazily now.",
    });
  });

  it("away without an update, past half a minute: it isn't answering, as before", () => {
    const reply = row({ nowMs: offMs + 45_000, updating: false, connected: false });
    expect(reply?.kind === "words" ? reply.text : "").toMatch(/^Nova isn't answering since /);
  });
});

describe("changeLineWords — the line of a Mate's open changes", () => {
  it.each([
    { case: "its own, by title", change: { title: "Cart page", mine: true }, words: "Cart page" },
    {
      case: "a colleague's, in review",
      change: { title: "Cart page", mine: false },
      words: "Cart page · in review",
    },
    {
      case: "several, how many",
      change: { title: "Cart page", mine: true, count: 2 },
      words: "2 changes in review",
    },
  ])("$case", ({ change, words }) => {
    expect(changeLineWords({ kind: "change", ...change })).toBe(words);
  });
});
