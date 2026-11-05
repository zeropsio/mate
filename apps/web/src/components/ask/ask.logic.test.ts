import { describe, expect, it } from "vite-plus/test";

import {
  askWhereWords,
  askWhomWords,
  authorityWords,
  docksAboveComposer,
  isProduction,
  notNowWords,
  type AskStateKind,
} from "./ask.logic";

describe("where an ask acts, in one chip", () => {
  it.each([
    {
      name: "this Mate, every app",
      where: { scope: "mate", detail: "every app" },
      want: "This Mate · every app",
    },
    {
      name: "a service on production",
      where: { scope: "production", detail: "api" },
      want: "Production · api",
    },
    { name: "stage alone", where: { scope: "stage", detail: null }, want: "Stage" },
    { name: "the project", where: { scope: "project", detail: null }, want: "Project" },
    {
      name: "another Mate, by its name",
      where: { scope: "otherMate", detail: "Rossy" },
      want: "Rossy",
    },
    {
      name: "an organization by its name",
      where: { scope: "organization", detail: "Acme" },
      want: "Organization · Acme",
    },
  ] as const)("the chip names the target: $name", ({ where, want }) => {
    expect(askWhereWords(where)).toBe(want);
  });

  it.each([
    { scope: "production", want: true },
    { scope: "stage", want: false },
    { scope: "mate", want: false },
    { scope: "organization", want: false },
  ] as const)("only production carries the risk colour: $scope", ({ scope, want }) => {
    expect(isProduction({ scope, detail: null })).toBe(want);
  });
});

describe("who answered, and who can", () => {
  it.each([
    { name: "who and when", by: "Aleš", at: "15:04", want: "Not now · Aleš, 15:04" },
    { name: "nobody named", by: null, at: "15:04", want: "Not now · 15:04" },
    { name: "nothing known", by: null, at: null, want: "Not now" },
  ])("Not now says who said it and when: $name", ({ by, at, want }) => {
    expect(notNowWords(by, at)).toBe(want);
  });

  it.each([
    {
      name: "two people",
      names: ["Petr", "Jana"],
      want: "Only people with production access can set this. Petr and Jana can.",
      ask: "Ask Petr",
    },
    {
      name: "three people",
      names: ["Petr", "Jana", "Ota"],
      want: "Only people with production access can set this. Petr, Jana and Ota can.",
      ask: "Ask Petr",
    },
    {
      name: "nobody named",
      names: [],
      want: "Only people with production access can set this.",
      ask: null,
    },
  ])("someone else's ask names who can answer it: $name", ({ names, want, ask }) => {
    expect(authorityWords("Only people with production access can set this.", names)).toBe(want);
    expect(askWhomWords(names)).toBe(ask);
  });
});

describe("an ask docks above the composer while the Mate is stopped on it and its card is out of view", () => {
  it.each<{ state: AskStateKind; running: boolean; cardOnScreen: boolean; want: boolean }>([
    { state: "waiting", running: false, cardOnScreen: false, want: true },
    { state: "waiting", running: false, cardOnScreen: true, want: false },
    { state: "waiting", running: true, cardOnScreen: false, want: false },
    { state: "working", running: false, cardOnScreen: false, want: true },
    { state: "failed", running: false, cardOnScreen: false, want: true },
    { state: "othersToAnswer", running: false, cardOnScreen: false, want: true },
    { state: "done", running: false, cardOnScreen: false, want: false },
    { state: "notNow", running: false, cardOnScreen: false, want: false },
    { state: "replaced", running: false, cardOnScreen: false, want: false },
  ])(
    "$state, turn running $running, card on screen $cardOnScreen: docks $want",
    ({ state, running, cardOnScreen, want }) => {
      expect(docksAboveComposer(state, { turnRunning: running, cardOnScreen })).toBe(want);
    },
  );
});
