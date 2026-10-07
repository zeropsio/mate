/**
 * Exhaustive right-panel availability, launcher copy, and migration policy.
 *
 * Availability controls whether a kind can be launched; it never reconciles
 * persisted surfaces. In particular, Diff and Zerops tabs remain visible when
 * a Git or topology answer arrives late or later becomes unavailable, and the
 * existing tab controls remain the way to close them. A `hidden` kind has no
 * launcher card at all: an `unavailable` one still draws a disabled card, and
 * that alone would say the surface exists.
 */
import type { CrewStatus } from "@t3tools/contracts";

export const RIGHT_PANEL_KINDS = [
  "terminal",
  "files",
  "file",
  "diff",
  "agents",
  "zerops",
  "browser",
  "data",
  "git",
  "crew",
  "mcp",
  "vault",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type RightPanelAvailability = "available" | "unavailable" | "unknown" | "hidden";

export interface RightPanelAvailabilityInput {
  readonly projectOpen: boolean;
  readonly gitRepo: boolean | null;
  readonly serverThread: boolean;
  readonly zeropsPanel: "available" | "unavailable" | "unknown";
  /**
   * The crew feed's latest status (`useCrew`); `null` before it answers. The
   * feed's capability alone would only say the method exists (seam 21).
   */
  readonly crewStatus: CrewStatus | null;
}

export interface RightPanelKindMeta {
  readonly launcher: {
    readonly label: string;
    readonly description: string;
    readonly shortcut: string;
    readonly unavailableHint: string;
  } | null;
  readonly availability: (input: RightPanelAvailabilityInput) => RightPanelAvailability;
}

const projectAvailability = (input: RightPanelAvailabilityInput): RightPanelAvailability =>
  input.projectOpen ? "available" : "unavailable";

export const RIGHT_PANEL_KIND_META = {
  terminal: {
    launcher: {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      shortcut: "T",
      unavailableHint: "Available when a project is open.",
    },
    availability: projectAvailability,
  },
  files: {
    launcher: {
      label: "Files",
      description: "Browse and read workspace files.",
      shortcut: "F",
      unavailableHint: "Available when a project is open.",
    },
    availability: projectAvailability,
  },
  file: {
    launcher: null,
    availability: projectAvailability,
  },
  diff: {
    launcher: {
      label: "Diff",
      description: "Review changes in this thread.",
      shortcut: "D",
      unavailableHint: "Available for Git repositories.",
    },
    // A Mate's workspace is no repository of its own, but each turn keeps a
    // diff of the services' checkouts below it (`resolveDiffSelection`).
    availability: (input) =>
      !input.serverThread
        ? "unavailable"
        : input.gitRepo === true || input.zeropsPanel === "available"
          ? "available"
          : input.gitRepo === null || input.zeropsPanel === "unknown"
            ? "unknown"
            : "unavailable",
  },
  agents: {
    launcher: {
      label: "Helpers",
      description: "Follow the helpers it started and their workflows.",
      shortcut: "A",
      unavailableHint: "Available from a thread.",
    },
    availability: () => "available",
  },
  zerops: {
    launcher: {
      label: "Zerops",
      description: "See the project's services.",
      shortcut: "Z",
      unavailableHint: "Available in a Zerops project.",
    },
    availability: (input) => input.zeropsPanel,
  },
  browser: {
    launcher: {
      label: "Browser",
      description: "Watch the agent's browser live.",
      shortcut: "B",
      unavailableHint: "Available in a Zerops project.",
    },
    availability: (input) => input.zeropsPanel,
  },
  data: {
    launcher: {
      label: "Data",
      description: "Browse databases and storage.",
      // D/A/T are already Diff/Agents/Terminal; V stands in for "view".
      shortcut: "V",
      unavailableHint: "Available in a Zerops project.",
    },
    availability: (input) => input.zeropsPanel,
  },
  git: {
    launcher: {
      label: "Git",
      description: "Follow branches and where they go.",
      shortcut: "G",
      unavailableHint: "Available in a Zerops project.",
    },
    availability: (input) => input.zeropsPanel,
  },
  crew: {
    launcher: {
      label: "Crew",
      description: "Set up a crew and follow its tasks.",
      shortcut: "C",
      unavailableHint: "Available in a Zerops project with crew mode on.",
    },
    availability: (input) =>
      input.zeropsPanel === "available" &&
      (input.crewStatus === "none" || input.crewStatus === "applied")
        ? "available"
        : "hidden",
  },
  mcp: {
    launcher: {
      label: "MCP",
      description: "Add and check your agents' tools.",
      shortcut: "M",
      unavailableHint: "Available from a conversation.",
    },
    // Every Mate's agents take MCP servers; the tab asks the Mate, not Zerops.
    availability: () => "available",
  },
  vault: {
    launcher: {
      label: "Vault",
      description: "Settings and secrets your apps use.",
      // V is Data's; E stands in for the environment's variables.
      shortcut: "E",
      unavailableHint: "Available in a Zerops project.",
    },
    availability: (input) => input.zeropsPanel,
  },
} satisfies Record<RightPanelKind, RightPanelKindMeta>;

export const DROPPED_RIGHT_PANEL_KINDS = ["plan", "pull-request", "preview"] as const;

type RightPanelLauncherKind = {
  [Kind in RightPanelKind]: (typeof RIGHT_PANEL_KIND_META)[Kind]["launcher"] extends null
    ? never
    : Kind;
}[RightPanelKind];

const rightPanelKindHasLauncher = (kind: RightPanelKind): kind is RightPanelLauncherKind =>
  RIGHT_PANEL_KIND_META[kind].launcher !== null;

export function resolveRightPanelAvailability(
  input: RightPanelAvailabilityInput,
): Record<RightPanelKind, RightPanelAvailability> {
  return Object.fromEntries(
    RIGHT_PANEL_KINDS.map((kind) => [kind, RIGHT_PANEL_KIND_META[kind].availability(input)]),
  ) as Record<RightPanelKind, RightPanelAvailability>;
}

export function launcherActions(availability: Record<RightPanelKind, RightPanelAvailability>) {
  return RIGHT_PANEL_KINDS.filter(rightPanelKindHasLauncher)
    .filter((kind) => availability[kind] !== "hidden")
    .map((kind) => {
      const launcher = RIGHT_PANEL_KIND_META[kind].launcher;
      return { kind, ...launcher, available: availability[kind] === "available" };
    });
}
