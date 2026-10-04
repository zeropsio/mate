import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  homeDoor,
  homeGuess,
  homeView,
  readHomeLanding,
  writeHomeLanding,
} from "./homeLanding.logic";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("homeView: the home never stands blank while it waits", () => {
  const base = {
    landing: "unknown",
    startFailed: false,
    targeted: false,
    remembered: null,
    projectsRead: false,
  } as const;
  it.each([
    ["landing unknown, nothing remembered: the wait line", {}, { kind: "wait" }],
    [
      "landing unknown, the Mate it landed on last remembered: its opening stage",
      { remembered: ref },
      { kind: "opening", ref },
    ],
    [
      "a connect hands over another environment: never the remembered Mate",
      { remembered: ref, targeted: true },
      { kind: "wait" },
    ],
    [
      "landing known, on its way there: what it waited with stays",
      { landing: "going", remembered: ref },
      { kind: "opening", ref },
    ],
    ["landing known, on its way, nothing remembered", { landing: "going" }, { kind: "wait" }],
    // "No projects" is an answer: never before the read is whole.
    ["no landing, the projects not read yet", { landing: "none" }, { kind: "wait" }],
    [
      "no landing, the projects not read yet, a Mate remembered",
      { landing: "none", remembered: ref },
      { kind: "opening", ref },
    ],
    [
      "no landing, the projects read whole: the hero",
      { landing: "none", projectsRead: true, remembered: ref },
      { kind: "hero" },
    ],
    [
      "the draft would not start",
      { landing: "going", startFailed: true, remembered: ref },
      { kind: "start-failed" },
    ],
  ] as const)("%s", (_case, over, view) => {
    expect(homeView({ ...base, ...over })).toEqual(view);
  });
});

describe("the home's landing as remembered", () => {
  it.each([
    ["a landing written", writeHomeLanding(ref), ref],
    ["nothing written", null, null],
    ["not JSON", "{", null],
    ["another shape", JSON.stringify({ environmentId: 3 }), null],
  ] as const)("%s", (_case, text, read) => {
    expect(readHomeLanding(text)).toEqual(read);
  });
});

// The home lands on the Mate most recently active (`_chat.index.tsx`): its guess, read from what
// this browser remembers, follows the same rule, so a Mate working in the background while
// another conversation was open last is not guessed wrong and taken back.
describe("homeGuess: the Mate the home will land on, as remembered", () => {
  const QUILL = EnvironmentId.make("env-quill");
  const FERN = EnvironmentId.make("env-fern");
  const quill = { projectId: "p-quill", running: true };
  const mates = { [QUILL]: quill, [FERN]: { projectId: "p-fern", running: true } };
  const row = (at: string, threadId: string) => ({ at, threadId });
  const lastOpen = scopeThreadRef(QUILL, ThreadId.make("thread-ivy"));
  it.each([
    [
      "the Mate with the latest remembered activity, over the conversation open last",
      {
        mates,
        rows: {
          "p-quill": row("2026-10-01T10:00:00Z", "thread-ivy"),
          "p-fern": row("2026-10-02T10:00:00Z", "thread-oak"),
        },
        lastOpen,
      },
      scopeThreadRef(FERN, ThreadId.make("thread-oak")),
    ],
    [
      "the conversation open last when its Mate is the latest active",
      {
        mates,
        rows: {
          "p-quill": row("2026-10-02T10:00:00Z", "thread-elm"),
          "p-fern": row("2026-10-01T10:00:00Z", "thread-oak"),
        },
        lastOpen,
      },
      lastOpen,
    ],
    [
      "a Mate whose container was stopped is not landed on while another runs",
      {
        mates: { ...mates, [FERN]: { projectId: "p-fern", running: false } },
        rows: {
          "p-quill": row("2026-10-01T10:00:00Z", "thread-ivy"),
          "p-fern": row("2026-10-02T10:00:00Z", "thread-oak"),
        },
        lastOpen,
      },
      lastOpen,
    ],
    [
      "every Mate stopped: the latest active all the same",
      {
        mates: {
          [QUILL]: { projectId: "p-quill", running: false },
          [FERN]: { projectId: "p-fern", running: false },
        },
        rows: {
          "p-quill": row("2026-10-01T10:00:00Z", "thread-ivy"),
          "p-fern": row("2026-10-02T10:00:00Z", "thread-oak"),
        },
        lastOpen,
      },
      scopeThreadRef(FERN, ThreadId.make("thread-oak")),
    ],
    ["no activity remembered: the conversation open last", { mates, rows: {}, lastOpen }, lastOpen],
    [
      "a row for a Mate this browser no longer knows is not offered",
      {
        mates: { [QUILL]: quill },
        rows: { "p-fern": row("2026-10-02T10:00:00Z", "thread-oak") },
        lastOpen,
      },
      lastOpen,
    ],
    [
      "an unreadable time is no activity",
      { mates, rows: { "p-fern": row("soon", "thread-oak") }, lastOpen },
      lastOpen,
    ],
    ["nothing remembered at all", { mates: {}, rows: {}, lastOpen: null }, null],
  ] as const)("%s", (_case, input, guess) => {
    expect(homeGuess(input)).toEqual(guess);
  });
});

describe("homeDoor: the home paints the projects page only when it stays there", () => {
  const base = {
    noEnvironments: false,
    matesSettled: false,
    projectsShown: false,
    organization: "selected",
    accountTrouble: false,
    catalogFailed: false,
  } as const;
  it.each([
    ["Mates registered, still reading: the landing", {}, "landing"],
    ["Mates registered, read whole: the landing", { matesSettled: true }, "landing"],
    // A cold load counts no environment until the account's Mates register: the projects page
    // painted then is taken back a second later, when the landing moves to a Mate. Nor does it
    // land anywhere meanwhile: with no usable environment, a cached thread is a dead Mate's.
    ["no Mate registered yet, still reading: it waits", { noEnvironments: true }, "wait"],
    [
      "no Mate to land on, read whole: the projects",
      { noEnvironments: true, matesSettled: true },
      "projects",
    ],
    // The Mates are never listed until something happens: the projects page says what.
    [
      "no organization chosen: the projects page, which asks for one",
      { noEnvironments: true, organization: "needs-selection" },
      "projects",
    ],
    [
      "the organizations still loading: it waits",
      { noEnvironments: true, organization: "loading" },
      "wait",
    ],
    [
      "the account's access failed: the projects page, which says so",
      { noEnvironments: true, accountTrouble: true },
      "projects",
    ],
    [
      "the environment catalog failed to load: the projects page",
      { noEnvironments: true, catalogFailed: true },
      "projects",
    ],
    // Once painted it stays until a Mate is counted: a registration on its way or an organization
    // switch unsettles the Mates again, and must not tear the page down.
    [
      "the projects page shown, the Mates unsettled again: it stays",
      { noEnvironments: true, projectsShown: true },
      "projects",
    ],
    [
      "the projects page shown, a Mate counted: the landing",
      { projectsShown: true, matesSettled: true },
      "landing",
    ],
  ] as const)("%s", (_name, over, expected) => {
    expect(homeDoor({ ...base, ...over })).toBe(expected);
  });
});
