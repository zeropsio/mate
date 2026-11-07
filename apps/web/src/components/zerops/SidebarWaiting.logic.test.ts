import { describe, expect, it } from "vite-plus/test";

import {
  releaseWaitingLine,
  waitingItemsOf,
  waitingKindOf,
  waitingPhrase,
  waitingCountWords,
  waitingSummary,
  waitingTitle,
  type WaitingItem,
  type WaitingMate,
} from "./SidebarWaiting.logic";

const mate = (name: string, kind: WaitingMate["kind"], text?: string): WaitingMate => ({
  projectId: name.toLowerCase(),
  name,
  tint: "slate",
  shape: "squircle",
  face: "needs",
  kind,
  ...(text === undefined ? {} : { text }),
});

const item = (waiting: WaitingMate): WaitingItem => ({
  kind: waiting.kind,
  key: `m:${waiting.projectId}`,
  mate: waiting,
});

const release: WaitingItem = {
  kind: "release",
  key: "r:tea",
  release: { groupId: "tea", name: "Tea Shop", ahead: 3 },
};

describe("waitingKindOf — what a Mate waits on the viewer for", () => {
  it.each([
    { title: "a plan it proposed is approved", activity: "planReady", review: false, kind: "plan" },
    { title: "a question it asks is answered", activity: "input", review: false, kind: "question" },
    {
      title: "an approval it asks is a question",
      activity: "approval",
      review: false,
      kind: "question",
    },
    { title: "its change waiting is reviewed", activity: "idle", review: true, kind: "change" },
    {
      title: "a question it asks comes before its change",
      activity: "input",
      review: true,
      kind: "question",
    },
    {
      title: "stopped on an error, it is helped",
      activity: "failed",
      review: false,
      kind: "failed",
    },
  ] as const)("$title", ({ activity, review, kind }) => {
    expect(waitingKindOf({ activityKind: activity, reviewWaits: review })).toBe(kind);
  });
});

describe("waitingPhrase — each thing in a few plain words", () => {
  it.each([
    { waiting: item(mate("Wren", "plan")), phrase: "Approve Wren's plan" },
    { waiting: item(mate("Rhea", "question")), phrase: "Answer Rhea" },
    { waiting: item(mate("Fen", "failed")), phrase: "Help Fen" },
    { waiting: item(mate("Noibit", "change")), phrase: "Review Noibit's change" },
    { waiting: release, phrase: "Release Tea Shop" },
  ])("$phrase", ({ waiting, phrase }) => {
    expect(waitingPhrase(waiting)).toBe(phrase);
  });
});

describe("waitingSummary — the Waiting on you row's second line", () => {
  it.each([
    {
      title: "says the first two in ink, then how many more",
      items: [item(mate("Fen", "failed")), item(mate("Wren", "plan")), release],
      summary: { words: "Help Fen · Approve Wren's plan", more: 1 },
    },
    {
      title: "says two alone with nothing more",
      items: [item(mate("Wren", "plan")), release],
      summary: { words: "Approve Wren's plan · Release Tea Shop", more: 0 },
    },
    {
      title: "says one alone",
      items: [release],
      summary: { words: "Release Tea Shop", more: 0 },
    },
  ])("$title", ({ items, summary }) => {
    expect(waitingSummary(items)).toEqual(summary);
  });
});

// Run 2: an amber 1 stood in the menu's header with no noun beside it.
describe("waitingCountWords — what the menu's bare count says it counts", () => {
  it.each([
    {
      title: "A count says what waits on the person, by name",
      items: [release],
      words: { label: "1 waiting on you: Release Tea Shop", line: "Release Tea Shop" },
    },
    {
      title: "A count past two says how many more",
      items: [item(mate("Fen", "failed")), item(mate("Wren", "plan")), release],
      words: {
        label: "3 waiting on you: Help Fen · Approve Wren's plan, 1 more",
        line: "Help Fen · Approve Wren's plan · 1 more",
      },
    },
  ])("$title", ({ items, words }) => {
    expect(waitingCountWords(items)).toEqual(words);
  });
});

describe("the list's words for each thing", () => {
  it("names a Mate's thing by the Mate, and a release by its project", () => {
    expect(waitingTitle(item(mate("Wren", "plan")))).toBe("Wren");
    expect(waitingTitle(release)).toBe("Tea Shop is ready to release");
  });

  it.each([
    { ahead: 3, line: "3 changes are on stage, not yet in production." },
    { ahead: 1, line: "1 change is on stage, not yet in production." },
    { ahead: undefined, line: "What is on stage is not in production yet." },
    // HQ's offer that is not read yet counts nothing: its zero is never said as a count.
    { ahead: 0, line: "What is on stage is not in production yet." },
  ])("says what a release would carry: $line", ({ ahead, line }) => {
    expect(releaseWaitingLine({ groupId: "tea", name: "Tea Shop", ahead })).toBe(line);
  });
});

describe("waitingItemsOf — everything waiting on the viewer, one list", () => {
  it("lists the Mates' things in the menu's order, then every release offered", () => {
    const items = waitingItemsOf({
      mates: [mate("Fen", "failed"), mate("Wren", "plan")],
      releases: [{ groupId: "tea", name: "Tea Shop", ahead: 3 }],
    });
    expect(items.map((waiting) => waiting.key)).toEqual(["m:fen", "m:wren", "r:tea"]);
    expect(items.map((waiting) => waiting.kind)).toEqual(["failed", "plan", "release"]);
  });
});

it("A waiting release shows its recorded changes and commits separately.", () => {
  expect(releaseWaitingLine({ groupId: "tea", name: "Tea Shop", ahead: 6, changeCount: 1 })).toBe(
    "1 change · 6 commits waiting for production.",
  );
});
