import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  homeGuess,
  homeTarget,
  homeView,
  hqHomeMate,
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
    hqMatesRead: true,
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
      "platform and catalog settled, HQ unread: keep waiting",
      { landing: "none", projectsRead: true, hqMatesRead: false },
      { kind: "wait" },
    ],
    [
      "platform and catalog settled, HQ unread: keep the remembered opening",
      { landing: "none", projectsRead: true, hqMatesRead: false, remembered: ref },
      { kind: "opening", ref },
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

describe("the home from HQ, before any Mate socket opens", () => {
  const mates = new Map([
    [
      "old-online",
      { presence: { online: true, since: "2026-10-03T10:00:00Z", overview: "none" as const } },
    ],
    [
      "new-offline",
      { presence: { online: false, since: "2026-10-04T10:00:00Z", overview: "none" as const } },
    ],
  ]) satisfies HqMates;
  it("passes over a Mate being deleted", () => {
    expect(hqHomeMate(mates, new Set(["old-online"]))).toBe("new-offline");
  });
  it("opens the online Mate without needing a registered environment", () => {
    expect(hqHomeMate(mates)).toBe("old-online");
  });
  it("falls back to the last known Mate while they are all offline", () => {
    expect(
      hqHomeMate(
        new Map(
          [...mates].map(([id, mate]) => [
            id,
            { ...mate, presence: { ...mate.presence, online: false } },
          ]),
        ),
      ),
    ).toBe("new-offline");
  });
  it("earns no destination before HQ knows any Mate", () => {
    expect(hqHomeMate(null)).toBeUndefined();
    expect(hqHomeMate(new Map())).toBeUndefined();
  });
});

describe("homeTarget: where the home lands, and never on a Mate that is gone", () => {
  const quill = EnvironmentId.make("env-quill");
  const fern = EnvironmentId.make("env-fern");
  const base = {
    target: null,
    hqMate: undefined,
    hqMatesRead: true,
    environments: [],
  } as const;
  it.each([
    [
      "a connect names an environment whose shell has not arrived: unknown",
      { target: { environmentId: quill, bootstrapped: false }, hqMate: "proj-ivy" },
      null,
    ],
    [
      "a connect names an environment, its shell here: that one, before HQ's",
      { target: { environmentId: quill, bootstrapped: true }, hqMate: "proj-ivy" },
      { kind: "environment", environmentId: quill },
    ],
    [
      "HQ names a Mate: that Mate",
      { hqMate: "proj-ivy", hqMatesRead: false },
      { kind: "mate", projectId: "proj-ivy" },
    ],
    ["HQ not read yet, naming none: unknown", { hqMatesRead: false }, null],
    [
      "a socket on its first attempt: unknown",
      { environments: [{ environmentId: quill, phase: "connecting", snapshot: false }] },
      null,
    ],
    [
      "a live socket whose shell has not arrived: unknown",
      { environments: [{ environmentId: quill, phase: "connected", snapshot: false }] },
      null,
    ],
    [
      "live sockets: among them only",
      {
        environments: [
          { environmentId: quill, phase: "connected", snapshot: true },
          { environmentId: fern, phase: "error", snapshot: true },
        ],
      },
      { kind: "among", environmentIds: [quill] },
    ],
    // Restores f3c9cba48's rule: a registration that does not answer keeps its cached projects,
    // and with HQ down naming none of them, its old conversation is a Mate that may be gone.
    [
      "HQ down, a dead registration still cached: nowhere",
      {
        environments: [
          { environmentId: quill, phase: "error", snapshot: true },
          { environmentId: fern, phase: "reconnecting", snapshot: true },
        ],
      },
      { kind: "none" },
    ],
    [
      "a registration held but not opened: nowhere, HQ names the Mates",
      { environments: [{ environmentId: quill, phase: "available", snapshot: true }] },
      { kind: "none" },
    ],
    ["no environment at all: nowhere", {}, { kind: "none" }],
  ] as const)("%s", (_case, over, target) => {
    expect(homeTarget({ ...base, ...over })).toEqual(target);
  });
});
