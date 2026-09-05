import { describe, expect, it } from "vite-plus/test";

import {
  DROPPED_RIGHT_PANEL_KINDS,
  RIGHT_PANEL_KINDS,
  RIGHT_PANEL_KIND_META,
  launcherActions,
  resolveRightPanelAvailability,
  type RightPanelAvailabilityInput,
} from "./rightPanelKinds";

const AVAILABLE_INPUT: RightPanelAvailabilityInput = {
  projectOpen: true,
  gitRepo: true,
  serverThread: true,
  zeropsPanel: "available",
};

describe("right panel kinds", () => {
  it("defines launcher and availability metadata for every kind", () => {
    expect(Object.keys(RIGHT_PANEL_KIND_META)).toEqual(RIGHT_PANEL_KINDS);
    for (const kind of RIGHT_PANEL_KINDS) {
      expect(RIGHT_PANEL_KIND_META[kind].availability).toBeTypeOf("function");
    }
  });

  it("keeps the six launcher rows in their established order", () => {
    expect(
      launcherActions(resolveRightPanelAvailability(AVAILABLE_INPUT)).map(
        ({ kind, label, description, shortcut, unavailableHint }) => ({
          kind,
          label,
          description,
          shortcut,
          unavailableHint,
        }),
      ),
    ).toEqual([
      {
        kind: "terminal",
        label: "Terminal",
        description: "Start a shell in this workspace.",
        shortcut: "T",
        unavailableHint: "Available when a project is open.",
      },
      {
        kind: "files",
        label: "Files",
        description: "Browse and read workspace files.",
        shortcut: "F",
        unavailableHint: "Available when a project is open.",
      },
      {
        kind: "diff",
        label: "Diff",
        description: "Review changes in this thread.",
        shortcut: "D",
        unavailableHint: "Available for Git repositories.",
      },
      {
        kind: "agents",
        label: "Agents",
        description: "Follow subagents and workflows.",
        shortcut: "A",
        unavailableHint: "Available from a thread.",
      },
      {
        kind: "zerops",
        label: "Zerops",
        description: "See the project's services.",
        shortcut: "Z",
        unavailableHint: "Available in a Zerops project.",
      },
      {
        kind: "browser",
        label: "Browser",
        description: "Watch the agent's browser live.",
        shortcut: "B",
        unavailableHint: "Available in a Zerops project.",
      },
    ]);
  });

  it("derives every launcher row in right-panel kind tuple order", () => {
    expect(
      launcherActions(resolveRightPanelAvailability(AVAILABLE_INPUT)).map(({ kind }) => kind),
    ).toEqual(RIGHT_PANEL_KINDS.filter((kind) => RIGHT_PANEL_KIND_META[kind].launcher !== null));
  });

  const cases = [
    {
      name: "makes every supported kind available",
      input: AVAILABLE_INPUT,
      expected: {
        diff: "available",
        files: "available",
        file: "available",
        terminal: "available",
        agents: "available",
        zerops: "available",
        browser: "available",
      },
    },
    {
      name: "marks unsupported runtime and project kinds unavailable",
      input: {
        ...AVAILABLE_INPUT,
        projectOpen: false,
        gitRepo: false,
        serverThread: false,
        zeropsPanel: "unavailable",
      },
      expected: {
        diff: "unavailable",
        files: "unavailable",
        file: "unavailable",
        terminal: "unavailable",
        agents: "available",
        zerops: "unavailable",
        browser: "unavailable",
      },
    },
    {
      name: "keeps late Git and Zerops answers unknown",
      input: { ...AVAILABLE_INPUT, gitRepo: null, zeropsPanel: "unknown" },
      expected: {
        diff: "unknown",
        files: "available",
        file: "available",
        terminal: "available",
        agents: "available",
        zerops: "unknown",
        browser: "unknown",
      },
    },
    {
      name: "does not wait for Git when there is no server thread",
      input: { ...AVAILABLE_INPUT, gitRepo: null, serverThread: false },
      expected: {
        diff: "unavailable",
        files: "available",
        file: "available",
        terminal: "available",
        agents: "available",
        zerops: "available",
        browser: "available",
      },
    },
  ] as const;

  it.each(cases)("$name", ({ input, expected }) => {
    expect(resolveRightPanelAvailability(input)).toEqual(expected);
  });

  it("names every retired persisted kind in one migration list", () => {
    expect(DROPPED_RIGHT_PANEL_KINDS).toEqual(["plan", "pull-request", "preview"]);
  });
});
