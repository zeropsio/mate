import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type * as CollapsedProjectsModule from "./collapsedProjects";
import type * as AccountLifetimeModule from "./accountLifetime";

/** The key the stops' fold wrote before the project collapse replaced it. */
const RETIRED_KEY = "zerops.sidebar.collapsedStops";

let values: Map<string, string>;
let lifetime: typeof AccountLifetimeModule;
let projects: typeof CollapsedProjectsModule;

beforeEach(async () => {
  values = new Map();
  const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  lifetime = await import("./accountLifetime");
  projects = await import("./collapsedProjects");
});

afterEach(() => {
  lifetime.closeAccountLifetime();
  vi.unstubAllGlobals();
});

describe("collapsed projects, per account", () => {
  it("a project collapsed by account A is not collapsed for account B in the same browser", () => {
    lifetime.openAccountLifetime("user-a");
    projects.writeCollapsedProjects(new Set(["group-a"]));

    lifetime.openAccountLifetime("user-b");
    expect(projects.readCollapsedProjects()).toEqual(new Set());
    projects.writeCollapsedProjects(new Set(["group-b"]));

    lifetime.openAccountLifetime("user-a");
    expect(projects.readCollapsedProjects()).toEqual(new Set(["group-a"]));
  });

  it("never reads what the stops' fold left behind", () => {
    lifetime.openAccountLifetime("user-a");
    values.set(RETIRED_KEY, JSON.stringify(["group-a"]));
    values.set(lifetime.accountStorageKey(RETIRED_KEY)!, JSON.stringify(["group-a"]));

    expect(projects.readCollapsedProjects()).toEqual(new Set());
  });

  it("no account reads or writes nothing", () => {
    projects.writeCollapsedProjects(new Set(["group-b"]));

    expect(projects.readCollapsedProjects()).toEqual(new Set());
    expect([...values.keys()]).toEqual([]);
  });

  it("reads storage that holds anything else as nothing collapsed", () => {
    lifetime.openAccountLifetime("user-a");
    values.set(lifetime.accountStorageKey("zerops.sidebar.collapsedProjects")!, "{not json");

    expect(projects.readCollapsedProjects()).toEqual(new Set());
  });
});

// Twenty projects open at once made the menu two screens long (the owner, 2026-10-11: "I'd have
// them collapsed all by default, when you have like 6+"): past five projects each starts as its
// one line, and what the person opened or folded stays as they left it.
describe("a project's fold", () => {
  const none = { closed: new Set<string>(), opened: new Set<string>() };
  it.each([
    {
      case: "folded by its person",
      folds: { ...none, closed: new Set(["a"]) },
      projects: 2,
      folded: true,
    },
    {
      case: "opened by its person among many",
      folds: { ...none, opened: new Set(["a"]) },
      projects: 20,
      folded: false,
    },
    { case: "untouched among five", folds: none, projects: 5, folded: false },
    { case: "untouched among six", folds: none, projects: 6, folded: true },
  ])(
    "stands as its person left it, else folded among six or more: $case",
    ({ folds, projects: count, folded }) => {
      expect(projects.projectFolded(folds, "a", count)).toBe(folded);
    },
  );

  it("keeps one choice per project: folding takes back an opening, and opening a fold", () => {
    const opened = projects.withProjectFold(
      { closed: new Set(["a"]), opened: new Set() },
      "a",
      false,
    );
    expect(opened).toEqual({ closed: new Set(), opened: new Set(["a"]) });
    expect(projects.withProjectFold(opened, "a", true)).toEqual({
      closed: new Set(["a"]),
      opened: new Set(),
    });
  });

  // The owner, 2026-10-12: "how about fold / unfold all here?"
  it.each([
    { fold: true, closed: ["a", "b", "c"], opened: [] },
    { fold: false, closed: [], opened: ["a", "b", "c"] },
  ])("folds every project at once, or opens every one: fold $fold", ({ fold, closed, opened }) => {
    const mixed = { closed: new Set(["a"]), opened: new Set(["b"]) };
    expect(projects.withProjectsFolded(mixed, ["a", "b", "c"], fold)).toEqual({
      closed: new Set(closed),
      opened: new Set(opened),
    });
  });

  it("remembers what the person opened, per account", () => {
    lifetime.openAccountLifetime("user-a");
    projects.writeOpenedProjects(new Set(["group-a"]));
    lifetime.openAccountLifetime("user-b");
    expect(projects.readOpenedProjects()).toEqual(new Set());
    lifetime.openAccountLifetime("user-a");
    expect(projects.readOpenedProjects()).toEqual(new Set(["group-a"]));
  });
});
