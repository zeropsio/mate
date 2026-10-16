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

  it("keeps the launcher rows in their established order", () => {
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
        description: "Review what this Mate changed.",
        shortcut: "D",
        unavailableHint: "Available for Git repositories.",
      },
      {
        kind: "agents",
        label: "Helpers",
        description: "Follow this Mate's helpers and their work.",
        shortcut: "A",
        unavailableHint: "Available from a chat.",
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
        description: "Watch this Mate's browser live.",
        shortcut: "B",
        unavailableHint: "Available in a Zerops project.",
      },
      {
        kind: "mac",
        label: "Mac",
        description: "Watch and use the app on the paired Mac.",
        shortcut: null,
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
        description: "Add and check this Mate's tools.",
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
    ).toEqual(
      RIGHT_PANEL_KINDS.filter(
        (kind) =>
          RIGHT_PANEL_KIND_META[kind].launcher !== null &&
          resolveRightPanelAvailability(AVAILABLE_INPUT)[kind] !== "hidden",
      ),
    );
  });

  // The owner, 2026-10-12: a Chief is the organization's, with no workspace or project of its own
  // to browse; its panel holds what it uses.
  it.each([
    [
      "a Chief's panel offers the overview, terminal, helpers and MCP",
      true,
      ["terminal", "agents", "mcp", "overview"],
    ],
    [
      "a Mate's panel offers every surface but the overview, as before",
      false,
      [
        "terminal",
        "files",
        "diff",
        "agents",
        "zerops",
        "browser",
        "mac",
        "data",
        "git",
        "crew",
        "mcp",
        "vault",
      ],
    ],
  ] as const)("%s", (_title, chief, kinds) => {
    expect(
      launcherActions(resolveRightPanelAvailability({ ...AVAILABLE_INPUT, chief })).map(
        ({ kind }) => kind,
      ),
    ).toEqual(kinds);
  });

  it("a Chief's panel opens nothing else, whatever its project would offer", () => {
    const availability = resolveRightPanelAvailability({ ...AVAILABLE_INPUT, chief: true });
    expect(RIGHT_PANEL_KINDS.filter((kind) => availability[kind] !== "hidden").toSorted()).toEqual([
      "agents",
      "mcp",
      "overview",
      "terminal",
    ]);
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
        mac: "available",
        git: "available",
        data: "available",
        crew: "available",
        mcp: "available",
        vault: "available",
        overview: "hidden",
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
        mac: "unavailable",
        git: "unavailable",
        data: "unavailable",
        crew: "hidden",
        mcp: "available",
        vault: "unavailable",
        overview: "hidden",
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
        mac: "unknown",
        git: "unknown",
        data: "unknown",
        crew: "hidden",
        mcp: "available",
        vault: "unknown",
        overview: "hidden",
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
        mac: "available",
        git: "available",
        data: "available",
        crew: "available",
        mcp: "available",
        vault: "available",
        overview: "hidden",
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
