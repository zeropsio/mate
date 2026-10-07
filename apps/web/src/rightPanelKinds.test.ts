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
  crewStatus: "applied",
};

describe("right panel kinds", () => {
  it("defines launcher and availability metadata for every kind", () => {
    expect(Object.keys(RIGHT_PANEL_KIND_META)).toEqual(RIGHT_PANEL_KINDS);
    for (const kind of RIGHT_PANEL_KINDS) {
      expect(RIGHT_PANEL_KIND_META[kind].availability).toBeTypeOf("function");
    }
  });

  it("keeps the eleven launcher rows in their established order", () => {
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
        label: "Helpers",
        description: "Follow the helpers it started and their workflows.",
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
      {
        kind: "data",
        label: "Data",
        description: "Browse databases and storage.",
        shortcut: "V",
        unavailableHint: "Available in a Zerops project.",
      },
      {
        kind: "git",
        label: "Git",
        description: "Follow branches and where they go.",
        shortcut: "G",
        unavailableHint: "Available in a Zerops project.",
      },
      {
        kind: "crew",
        label: "Crew",
        description: "Set up a crew and follow its tasks.",
        shortcut: "C",
        unavailableHint: "Available in a Zerops project with crew mode on.",
      },
      {
        kind: "mcp",
        label: "MCP",
        description: "Add and check your agents' tools.",
        shortcut: "M",
        unavailableHint: "Available from a conversation.",
      },
      {
        kind: "vault",
        label: "Vault",
        description: "Settings and secrets your apps use.",
        shortcut: "E",
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
        git: "available",
        data: "available",
        crew: "available",
        mcp: "available",
        vault: "available",
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
        git: "unavailable",
        data: "unavailable",
        crew: "hidden",
        mcp: "available",
        vault: "unavailable",
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
        git: "unknown",
        data: "unknown",
        crew: "hidden",
        mcp: "available",
        vault: "unknown",
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
        git: "available",
        data: "available",
        crew: "available",
        mcp: "available",
        vault: "available",
      },
    },
  ] as const;

  it.each(cases)("$name", ({ input, expected }) => {
    expect(resolveRightPanelAvailability(input)).toEqual(expected);
  });

  const crewCases = [
    { crewStatus: "applied", zeropsPanel: "available", card: true },
    { crewStatus: "none", zeropsPanel: "available", card: true },
    { crewStatus: "off", zeropsPanel: "available", card: false },
    { crewStatus: null, zeropsPanel: "available", card: false },
    { crewStatus: "applied", zeropsPanel: "unknown", card: false },
    { crewStatus: "applied", zeropsPanel: "unavailable", card: false },
  ] as const;

  it.each(crewCases)(
    "status $crewStatus with the Zerops panel $zeropsPanel: crew card $card",
    ({ crewStatus, zeropsPanel, card }) => {
      const actions = launcherActions(
        resolveRightPanelAvailability({ ...AVAILABLE_INPUT, crewStatus, zeropsPanel }),
      );
      const crew = actions.find(({ kind }) => kind === "crew");
      expect(crew === undefined ? false : crew.available).toBe(card);
      // A hidden kind is no card at all: a disabled one would still show the tab exists.
      expect(crew === undefined).toBe(!card);
    },
  );

  /**
   * A Mate's workspace (`/var/www`) is no Git repository of its own, so Diff
   * read "Available for Git repositories." on every Mate — yet each turn saves
   * a diff of the services' checkouts below it (the owner: "the diff tab
   * hasn't been working / doing anything for ages").
   */
  it.each([
    { gitRepo: false, zeropsPanel: "available", serverThread: true, diff: "available" },
    { gitRepo: false, zeropsPanel: "unknown", serverThread: true, diff: "unknown" },
    { gitRepo: null, zeropsPanel: "unavailable", serverThread: true, diff: "unknown" },
    { gitRepo: false, zeropsPanel: "unavailable", serverThread: true, diff: "unavailable" },
    { gitRepo: false, zeropsPanel: "available", serverThread: false, diff: "unavailable" },
  ] as const)(
    "Diff with Git $gitRepo and the Zerops panel $zeropsPanel (server thread $serverThread): $diff",
    ({ gitRepo, zeropsPanel, serverThread, diff }) => {
      expect(
        resolveRightPanelAvailability({ ...AVAILABLE_INPUT, gitRepo, zeropsPanel, serverThread })
          .diff,
      ).toBe(diff);
    },
  );

  it("names every retired persisted kind in one migration list", () => {
    expect(DROPPED_RIGHT_PANEL_KINDS).toEqual(["plan", "pull-request", "preview"]);
  });
});
