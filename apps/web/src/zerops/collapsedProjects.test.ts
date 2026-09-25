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
