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
    organizationId: "org-moss",
    organization: "selected",
    accountTrouble: false,
    catalogFailed: false,
    projectsShown: null,
  } as const;
  const projects = { kind: "projects", organizationId: "org-moss" } as const;
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
    // An empty organization lands on the projects page, where New project works: upstream's
    // "Add project" hero opened a folder picker with no environment in it.
    [
      "no landing, the projects read whole: the projects page",
      { landing: "none", projectsRead: true, remembered: ref },
      projects,
    ],
    [
      "a connect's environment holds no project: the projects page",
      { landing: "none", projectsRead: true, targeted: true, hqMatesRead: false },
      projects,
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
    // Restores f3c9cba48: the Mates are never listed until something happens, and the projects
    // page says what — the home never waits on a read that will not come.
    [
      "no organization chosen: the projects page, which asks for one",
      { landing: "none", organization: "needs-selection", organizationId: null, remembered: ref },
      { kind: "projects", organizationId: null },
    ],
    [
      "the organizations still loading: it waits",
      { landing: "none", organization: "loading", organizationId: null },
      { kind: "wait" },
    ],
    [
      "the account's access failed: the projects page, which says so",
      { landing: "none", accountTrouble: true },
      projects,
    ],
    [
      "the environment catalog failed, HQ names no Mate: the projects page and its Try again",
      { landing: "none", catalogFailed: true },
      projects,
    ],
    [
      "the environment catalog failed, HQ not read yet: it waits for HQ's Mate",
      { landing: "none", catalogFailed: true, hqMatesRead: false },
      { kind: "wait" },
    ],
    [
      "the environment catalog failed, HQ names a Mate: on its way there",
      { landing: "going", catalogFailed: true },
      { kind: "wait" },
    ],
    // Restores f3c9cba48: once painted, the projects page is torn down only by somebody here — a
    // registration on its way, HQ read again or a colleague's new Mate never take it back.
    [
      "the projects page shown, the read unsettled again: it stays",
      { landing: "none", projectsShown: { organizationId: "org-moss" }, remembered: ref },
      projects,
    ],
    [
      "the projects page shown, the landing unknown again: it stays",
      { landing: "unknown", projectsShown: { organizationId: "org-moss" }, remembered: ref },
      projects,
    ],
    [
      "the projects page shown, HQ names a Mate nobody here opened: it stays",
      { landing: "going", projectsShown: { organizationId: "org-moss" } },
      projects,
    ],
    [
      "the projects page shown, a connect hands over its environment: the landing",
      { landing: "going", targeted: true, projectsShown: { organizationId: "org-moss" } },
      { kind: "wait" },
    ],
    [
      "another organization chosen, still reading: the page stays as it was",
      { landing: "unknown", projectsShown: { organizationId: "org-fern" } },
      { kind: "projects", organizationId: "org-fern" },
    ],
    [
      "another organization chosen, its HQ names a Mate: on its way there",
      { landing: "going", projectsShown: { organizationId: "org-fern" }, remembered: ref },
      { kind: "wait" },
    ],
    [
      "another organization chosen, nowhere to land: the page is that organization's",
      { landing: "none", projectsRead: true, projectsShown: { organizationId: "org-fern" } },
      projects,
    ],
    [
      "the projects page shown, the draft would not start",
      {
        landing: "going",
        targeted: true,
        startFailed: true,
        projectsShown: { organizationId: "org-moss" },
      },
      { kind: "start-failed" },
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
    organizationId: "org-moss",
    target: null,
    hqMate: null,
    hqMatesRead: true,
    organizationProjects: new Set(["proj-quill", "proj-fern"]),
    environments: [],
  } as const;
  const ivy = { organizationId: "org-moss", projectId: "proj-ivy" } as const;
  const env = (
    environmentId: EnvironmentId,
    phase: "connecting" | "connected" | "reconnecting" | "available" | "error",
    snapshot: boolean,
    zeropsProjectId: { readonly is: string | null | undefined } = {
      is: environmentId === quill ? "proj-quill" : "proj-fern",
    },
  ) => ({ environmentId, phase, snapshot, zeropsProjectId: zeropsProjectId.is });
  it.each([
    [
      "a connect names an environment whose shell has not arrived: unknown",
      { target: { environmentId: quill, bootstrapped: false }, hqMate: ivy },
      null,
    ],
    [
      "a connect names an environment, its shell here: that one, before HQ's",
      { target: { environmentId: quill, bootstrapped: true }, hqMate: ivy },
      { kind: "environment", environmentId: quill },
    ],
    [
      "HQ names a Mate: that Mate",
      { hqMate: ivy, hqMatesRead: false },
      { kind: "mate", projectId: "proj-ivy" },
    ],
    ["HQ not read yet, naming none: unknown", { hqMatesRead: false }, null],
    // Switching organization on the projects page: HQ's Mates are the previous organization's
    // for a render, until its stream is keyed to the new one. They are not this one's landing.
    [
      "just switched organization, HQ's Mates still the previous one's: unknown",
      { hqMate: { organizationId: "org-fern", projectId: "proj-ivy" }, hqMatesRead: false },
      null,
    ],
    [
      "just switched to an organization without HQ, the previous one's Mate still named: nowhere",
      { hqMate: { organizationId: "org-fern", projectId: "proj-ivy" } },
      { kind: "none" },
    ],
    [
      "a socket on its first attempt: unknown",
      { environments: [env(quill, "connecting", false)] },
      null,
    ],
    [
      "a live socket whose shell has not arrived: unknown",
      { environments: [env(quill, "connected", false)] },
      null,
    ],
    [
      "live sockets: among them only",
      { environments: [env(quill, "connected", true), env(fern, "error", true)] },
      { kind: "among", environmentIds: [quill] },
    ],
    // The registrations are the account's, every organization's: only this one's claim it.
    [
      "another organization's live Mate: never",
      { environments: [env(quill, "connected", true, { is: "proj-elsewhere" })] },
      { kind: "none" },
    ],
    [
      "another organization's socket on its first attempt: no reason to wait",
      { environments: [env(quill, "connecting", false, { is: "proj-elsewhere" })] },
      { kind: "none" },
    ],
    [
      "a live server whose project is not said yet: never",
      { environments: [env(quill, "connected", true, { is: undefined })] },
      { kind: "none" },
    ],
    [
      "a live server outside Zerops, no organization's: among them",
      { environments: [env(quill, "connected", true, { is: null })] },
      { kind: "among", environmentIds: [quill] },
    ],
    // Restores f3c9cba48's rule: a registration that does not answer keeps its cached projects,
    // and with HQ down naming none of them, its old conversation is a Mate that may be gone.
    [
      "HQ down, a dead registration still cached: nowhere",
      { environments: [env(quill, "error", true), env(fern, "reconnecting", true)] },
      { kind: "none" },
    ],
    [
      "a registration held but not opened: nowhere, HQ names the Mates",
      { environments: [env(quill, "available", true)] },
      { kind: "none" },
    ],
    ["no environment at all: nowhere", {}, { kind: "none" }],
  ] as const)("%s", (_case, over, target) => {
    expect(homeTarget({ ...base, ...over })).toEqual(target);
  });
});
