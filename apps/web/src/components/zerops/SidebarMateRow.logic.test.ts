import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

import { changeMarkTone, mateOwnerView, mateRowView, ownerMark } from "./SidebarMateRow.logic";

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

  it.each([
    {
      case: "a named owner, signed in: the person, no line",
      owner: KAREL,
      records: SIGNED,
      asked: false,
      connected: true,
      seat: "person",
      line: undefined,
    },
    {
      case: "recorded, the member list not read, failed, or without them: a neutral seat",
      owner: undefined,
      records: SIGNED,
      asked: false,
      connected: true,
      seat: "unnamed",
      line: undefined,
    },
    {
      case: "nobody's and never asked, open here: the empty seat, the line and Sign in",
      owner: undefined,
      records: NOBODY,
      asked: false,
      connected: true,
      seat: "nobody",
      line: { words: LINE, verb: true },
    },
    {
      case: "nobody's, not open here yet: the line, and no verb a press would not reach",
      owner: undefined,
      records: NOBODY,
      asked: false,
      connected: false,
      seat: "nobody",
      line: { words: LINE, verb: false },
    },
    {
      case: "nobody's, but asked already (a project token): the empty seat and its own lines",
      owner: undefined,
      records: NOBODY,
      asked: true,
      connected: true,
      seat: "nobody",
      line: undefined,
    },
    {
      case: "the viewer's own, nobody signed in: their picture, the line and Sign in",
      owner: PETRA,
      records: OWNED_UNSIGNED,
      asked: false,
      connected: true,
      seat: "person",
      line: { words: LINE, verb: true },
    },
    {
      case: "a colleague's, nobody signed in: the line, theirs to sign in",
      owner: KAREL,
      records: OWNED_UNSIGNED,
      asked: false,
      connected: true,
      seat: "person",
      line: { words: LINE, verb: false },
    },
    {
      case: "an owner not named yet, nobody signed in: the line, no verb until they are",
      owner: undefined,
      records: OWNED_UNSIGNED,
      asked: false,
      connected: true,
      seat: "unnamed",
      line: { words: LINE, verb: false },
    },
  ])("$case", ({ owner, records, asked, connected, seat, line }) => {
    const view = mateOwnerView({ owner, records, asked, connected });
    expect(view.seat.kind).toBe(seat);
    expect(view.signIn).toEqual(line);
  });

  it("says the empty seat in words, and draws a person as their mark", () => {
    expect(
      mateOwnerView({ owner: undefined, records: NOBODY, asked: true, connected: false }).seat,
    ).toEqual({
      kind: "nobody",
      label: "No owner yet. Whoever signs in its coding agent owns it.",
    });
    expect(
      mateOwnerView({ owner: KAREL, records: SIGNED, asked: true, connected: true }).seat,
    ).toEqual({ kind: "person", mark: ownerMark(KAREL) });
  });
});

describe("changeMarkTone — the one colour a change row's mark may wear", () => {
  const change = (overrides: Partial<Parameters<typeof changeMarkTone>[0]> = {}) => ({
    number: 4,
    mergeability: "mergeable" as const,
    checks: "passing" as const,
    ...overrides,
  });
  // Amber is "didn't go through", red is "broken" (S3); everything else is
  // the mark's own grey — the verdict itself lives in the review.
  it.each([
    { case: "merges, checks passing", pull: change(), tone: undefined },
    { case: "merges, no checks", pull: change({ checks: "none" }), tone: undefined },
    { case: "merges, checks running", pull: change({ checks: "pending" }), tone: undefined },
    { case: "merges, checks failing", pull: change({ checks: "failing" }), tone: "failed" },
    {
      case: "behind main",
      pull: change({ mergeability: "conflicting", checks: "passing" }),
      tone: "attention",
    },
    {
      case: "behind main, checks failing",
      pull: change({ mergeability: "conflicting", checks: "failing" }),
      tone: "failed",
    },
    {
      case: "behind main, checks running",
      pull: change({ mergeability: "conflicting", checks: "pending" }),
      tone: undefined,
    },
    { case: "Gitea still checking", pull: change({ mergeability: "checking" }), tone: undefined },
  ] as const)("$case: $tone", ({ pull, tone }) => {
    expect(changeMarkTone(pull, false)).toBe(tone);
  });

  it("says nothing for a change drawn from memory: its verdict is Gitea's to say again", () => {
    expect(changeMarkTone(change({ checks: "failing" }), true)).toBeUndefined();
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
        liveStep: { words: "Compile the gallery", code: "npm run compile" },
      }),
      state: "working",
      rowFace: "working",
      slot: { kind: "clock", since: AT },
      dot: undefined,
      strong: false,
      reply: { kind: "live", words: "Compile the gallery", code: "npm run compile" },
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
        text: "Thumbnails load lazily now; the gallery opens in 90 ms.",
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
});
