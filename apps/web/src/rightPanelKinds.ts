/**
 * Exhaustive right-panel availability, launcher copy, and migration policy.
 *
 * Availability controls whether a kind can be launched; it never reconciles
 * persisted surfaces. In particular, Diff and Zerops tabs remain visible when
 * a Git or topology answer arrives late or later becomes unavailable, and the
 * existing tab controls remain the way to close them.
 */
export const RIGHT_PANEL_KINDS = [
  "preview",
  "terminal",
  "files",
  "file",
  "diff",
  "agents",
  "zerops",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type RightPanelAvailability = "available" | "unavailable" | "unknown";

export interface RightPanelAvailabilityInput {
  readonly previewSupported: boolean;
  readonly projectOpen: boolean;
  readonly gitRepo: boolean | null;
  readonly serverThread: boolean;
  readonly zeropsPanel: "available" | "unavailable" | "unknown";
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
  preview: {
    launcher: {
      label: "Browser",
      description: "Open a local app or URL.",
      shortcut: "B",
      unavailableHint: "Only available in the desktop app.",
    },
    availability: (input) => (input.previewSupported ? "available" : "unavailable"),
  },
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
    availability: (input) =>
      !input.serverThread
        ? "unavailable"
        : input.gitRepo === null
          ? "unknown"
          : input.gitRepo
            ? "available"
            : "unavailable",
  },
  agents: {
    launcher: {
      label: "Agents",
      description: "Follow subagents and workflows.",
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
} satisfies Record<RightPanelKind, RightPanelKindMeta>;

export const DROPPED_RIGHT_PANEL_KINDS = ["plan", "pull-request"] as const;

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
  return RIGHT_PANEL_KINDS.filter(rightPanelKindHasLauncher).map((kind) => {
    const launcher = RIGHT_PANEL_KIND_META[kind].launcher;
    return { kind, ...launcher, available: availability[kind] === "available" };
  });
}
