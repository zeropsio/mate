import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { MateComing } from "~/zerops/mateComing";
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
  mateRowPropsEqual,
  ownerBadge,
  mateRowAskLine,
  mateRowSentAsk,
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
  const KAREL = { name: "Karel Novák", initials: "KN", avatarUrl: null, isViewer: false };
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
    const view = mateOwnerView({ owner, records, asked, hqSigners: "none" });
    expect(view.seat.kind).toBe(seat);
    expect(view.signInLine).toBe(line);
  });

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
      madeBy: "user-petra",
      viewer: "user-petra",
      linked: true,
    });
    expect([view.seat.kind, view.signInLine, view.waitsOnViewer]).toEqual([seat, undefined, false]);
  });

  it("says the empty seat in words, and draws a person as their mark", () => {
    expect(
      mateOwnerView({ owner: undefined, records: NOBODY, asked: true, hqSigners: "none" }).seat,
    ).toEqual({
      kind: "nobody",
      label: "No owner yet. Whoever signs in its coding agent owns it.",
    });
    expect(
      mateOwnerView({ owner: KAREL, records: SIGNED, asked: true, hqSigners: "some" }).seat,
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
      dot: undefined,
      strong: false,
      reply: {
        kind: "words",
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
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
      dot: undefined,
      strong: false,
      reply: {
        kind: "words",
        text: "I've hit the Claude limit.",
        tone: "muted",
      },
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
        task: MATE_STAND_UP_MESSAGE,
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
        task: MATE_STAND_UP_MESSAGE,
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
        task: MATE_STAND_UP_MESSAGE,
        snippet: undefined,
        errorLine: "Build of appdev failed.",
      }),
      slot: { kind: "age" },
      dot: "failed",
      ask: undefined,
      reply: { kind: "words", text: "Setting up stopped", tone: "failed" },
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
      dot: undefined,
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
      case: "not created: asleep, the red dot of something broken",
      coming: { kind: "failed", line: "Could not be created.", verb: "remove" },
      face: "sleep",
      dot: "failed",
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
      tone: "failed",
    },
    {
      case: "the platform refused it",
      coming: { kind: "failed", line: "Could not be created.", verb: "remove" },
      nowMs: SINCE,
      text: "Setting up stopped",
      tone: "failed",
    },
    {
      case: "a New project's step stopped before the platform took anything",
      coming: { kind: "failed", line: "Git hosting could not be set up.", verb: "try-again" },
      nowMs: SINCE,
      text: "Setting up stopped",
      tone: "failed",
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
      tone: "failed",
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
      line: { kind: "ask", text: "Build a minimal todo app" },
    },
    {
      case: "asked before, a message just sent: the sent message over the old ask",
      input: {
        ...base,
        view: { ask: ASK, reply: WORDS, coming: undefined },
        sent: "and the logo",
      },
      line: { kind: "ask", text: "and the logo" },
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

// A message sent from this browser stands in the row's second line until its echo reaches the
// row's conversation (live, 2026-10-02: the draft cleared on send 0.4 s before the echo, and the
// row read "Nothing asked yet" in between). The echo carries the message's own time, the one this
// browser stamped it with: compared with it, no two clocks meet.
describe("mateRowSentAsk — what this browser just sent, until the conversation says it", () => {
  const SENT = {
    messageId: "message-2",
    threadId: "thread-1",
    text: "Build a minimal todo app",
    at: "2026-10-02T10:00:00.000Z",
  };
  const activity = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: ThreadId.make("thread-1"),
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Speed up the photo gallery",
    at: "2026-10-02T09:00:00.000Z",
    askedAt: "2026-10-02T08:59:00.000Z",
    snippet: "Thumbnails load lazily now.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Speed up the photo gallery",
    ...overrides,
  });

  it.each([
    { case: "nothing sent", sent: undefined, activity: activity(), read: true, text: undefined },
    {
      case: "sent, its conversations read and none there: the first, the row's",
      sent: SENT,
      activity: undefined,
      read: true,
      text: SENT.text,
    },
    {
      case: "sent, its conversations not read: nothing to say it is the row's",
      sent: SENT,
      activity: undefined,
      read: false,
      text: undefined,
    },
    {
      case: "sent, the conversation not caught up",
      sent: SENT,
      activity: activity(),
      read: true,
      text: SENT.text,
    },
    {
      case: "sent, the conversation says it",
      sent: SENT,
      activity: activity({ kind: "working", task: SENT.text, askedAt: SENT.at }),
      read: true,
      text: undefined,
    },
    {
      case: "sent, said, the server's clock behind this browser's",
      sent: SENT,
      activity: activity({ task: SENT.text, at: "2026-10-02T09:59:58.000Z", askedAt: SENT.at }),
      read: true,
      text: undefined,
    },
    {
      case: "sent, not said yet, the server's clock ahead of this browser's",
      sent: SENT,
      activity: activity({ at: "2026-10-02T10:00:03.000Z" }),
      read: true,
      text: SENT.text,
    },
    {
      case: "sent into another conversation than the row's",
      sent: { ...SENT, threadId: "thread-2" },
      activity: activity(),
      read: true,
      text: undefined,
    },
  ])("$case", ({ sent, activity, read, text }) => {
    expect(mateRowSentAsk(sent, activity, read)).toBe(text);
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
