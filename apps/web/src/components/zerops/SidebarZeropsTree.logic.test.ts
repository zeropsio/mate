import { describe, expect, it } from "vite-plus/test";

import {
  formatWorkingTime,
  isQuietMate,
  addressesPlace,
  projectHeadingMenu,
  QUIET_AFTER_MS,
  sidebarMateKey,
} from "./SidebarZeropsTree.logic";

describe("formatWorkingTime — how long a Mate has been at it", () => {
  it.each([
    { ms: 0, label: "0:00" },
    { ms: 7_000, label: "0:07" },
    { ms: 192_000, label: "3:12" },
    { ms: 3_599_000, label: "59:59" },
    { ms: 3_840_000, label: "1h 04m" },
    { ms: 37_800_000, label: "10h 30m" },
    // A clock skewed ahead of the server never reads as a negative time.
    { ms: -5_000, label: "0:00" },
  ])("reads $ms ms as $label", ({ ms, label }) => {
    expect(formatWorkingTime(ms)).toBe(label);
  });
});

describe("isQuietMate — a Mate untouched for a week folds away", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const WEEK = QUIET_AFTER_MS;
  it.each([
    {
      case: "resting a week and a minute",
      face: "idle",
      at: ago(WEEK + 60_000),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "resting six days",
      face: "idle",
      at: ago(WEEK - 86_400_000),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "done a fortnight ago, seen since",
      face: "done",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "done a fortnight ago, never looked at",
      face: "done",
      at: ago(2 * WEEK),
      unread: true,
      active: false,
      quiet: false,
    },
    {
      case: "waiting on somebody",
      face: "needs",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "working",
      face: "working",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "paused at a limit",
      face: "sleep",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "the one whose conversation is open",
      face: "idle",
      at: ago(2 * WEEK),
      unread: false,
      active: true,
      quiet: false,
    },
  ] as const)("is quiet: $case → $quiet", ({ face, at, unread, active, quiet }) => {
    expect(isQuietMate({ face, at, unread }, now, active)).toBe(quiet);
  });

  it("never folds a Mate nobody can date", () => {
    expect(isQuietMate(undefined, now, false)).toBe(false);
  });
});

describe("sidebarMateKey — the list's own keys on a Mate's row", () => {
  it.each([
    { key: "j", action: "next" },
    { key: "ArrowDown", action: undefined },
    { key: "k", action: "previous" },
    { key: "x", action: "stop" },
    { key: "X", action: "stop" },
    { key: "e", action: "unread" },
    { key: "E", action: "unread" },
    { key: "q", action: undefined },
  ] as const)("reads $key as $action", ({ key, action }) => {
    expect(sidebarMateKey({ key, modified: false })).toBe(action);
  });

  it("leaves every key with a modifier to whoever bound it", () => {
    expect(sidebarMateKey({ key: "j", modified: true })).toBeUndefined();
  });
});

describe("addressesPlace — the place a project's Addresses opens", () => {
  it.each([
    {
      case: "its production",
      input: { production: "prod", stages: ["stage"], mates: ["nell"] },
      place: "prod",
    },
    {
      case: "its first stage where it has no production",
      input: { production: undefined, stages: [undefined, "stage", "beta"], mates: ["nell"] },
      place: "stage",
    },
    {
      case: "its first Mate's own project where it has no production or stage",
      input: { production: undefined, stages: [], mates: ["nell", "odo"] },
      place: "nell",
    },
    { case: "none where it has no place", input: { production: undefined, stages: [], mates: [] } },
  ])("$case", ({ input, place }) => {
    expect(addressesPlace(input)).toBe(place);
  });
});

describe("projectHeadingMenu — a project heading's ···", () => {
  const menu = (over: Partial<Parameters<typeof projectHeadingMenu>[0]> = {}) =>
    projectHeadingMenu({
      collapsed: false,
      onToggle: () => {},
      onAddMate: () => {},
      onOpen: () => {},
      reorder: undefined,
      setUp: [],
      onBrowseProjects: () => {},
      ...over,
    }).map((entry) =>
      entry.kind === "separator" ? "—" : `${entry.label}${entry.disabled ? " (off)" : ""}`,
    );

  it.each([
    {
      case: "an open project: Fold, Add a Mate, Open project, then where projects are added",
      over: {},
      items: ["Fold", "Add a project Mate", "Open project", "—", "All projects"],
    },
    {
      case: "a folded one unfolds",
      over: { collapsed: true },
      items: ["Unfold", "Add a project Mate", "Open project", "—", "All projects"],
    },
    {
      case: "a heading that does not fold has no Fold",
      over: { onToggle: undefined },
      items: ["Add a project Mate", "Open project", "—", "All projects"],
    },
    {
      case: "moves, the first one up and the last one down off",
      over: {
        reorder: { canMoveUp: false, canMoveDown: true, onMove: () => {} },
      },
      items: [
        "Fold",
        "Add a project Mate",
        "Open project",
        "—",
        "Move up (off)",
        "Move down",
        "—",
        "All projects",
      ],
    },
    {
      case: "a project with a place has its Addresses after Open project",
      over: { onAddresses: () => {} },
      items: ["Fold", "Add a project Mate", "Open project", "Addresses", "—", "All projects"],
    },
    {
      case: "someone who may invite brings people into the project after Open project",
      over: { onInvite: () => {} },
      items: ["Fold", "Add a project Mate", "Open project", "Invite people", "—", "All projects"],
    },
    {
      case: "where HQ makes automated Mates, they are added right after a project Mate",
      over: { onAddAutomatedMates: () => {} },
      items: [
        "Fold",
        "Add a project Mate",
        "Add automated Mates…",
        "Open project",
        "—",
        "All projects",
      ],
    },
    {
      case: "a project that takes no Mate now takes no automated Mates either, saying why",
      over: { onAddAutomatedMates: () => {}, addMateWhy: "Its development is still being set up." },
      items: [
        "Fold",
        "Add a project Mate (off)",
        "Add automated Mates… (off)",
        "Open project",
        "—",
        "All projects",
      ],
    },
    {
      case: "a missing stage or production to add",
      over: { setUp: [{ label: "Add stage", act: () => {} }] },
      items: ["Fold", "Add a project Mate", "Open project", "—", "Add stage", "All projects"],
    },
  ])("$case", ({ over, items }) => {
    expect(menu(over)).toEqual(items);
  });

  it("does what each item says", () => {
    const did: Array<string> = [];
    const entries = projectHeadingMenu({
      collapsed: false,
      onToggle: () => did.push("fold"),
      onAddMate: () => did.push("add"),
      onOpen: () => did.push("open"),
      onAddresses: () => did.push("addresses"),
      onInvite: () => did.push("invite"),
      reorder: { canMoveUp: true, canMoveDown: true, onMove: (to) => did.push(to) },
      setUp: [],
      onBrowseProjects: () => did.push("browse"),
    });
    for (const entry of entries) if (entry.kind === "item") entry.act();
    expect(did).toEqual(["fold", "add", "open", "addresses", "invite", "up", "down", "browse"]);
  });
});
