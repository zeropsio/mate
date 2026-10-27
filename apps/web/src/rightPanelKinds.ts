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

import type { RightPanelSurface } from "./rightPanelStore";

/**
 * In the order a person reaches for them after a reply (the onboarding run, 2026-10-16): the app,
 * what changed and where it runs come before the developer's tools. The launcher lists them so.
 */
export const RIGHT_PANEL_KINDS = [
  "overview",
  "browser",
  "mac",
  "diff",
  "zerops",
  "agents",
  "crew",
  "files",
  "file",
  "git",
  "data",
  "vault",
  "terminal",
  "mcp",
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
  /**
   * A Chief's conversation (`chief.ts`): the organization's, with no workspace or project of its
   * own to browse, so its panel offers only what it uses (`CHIEF_PANEL_KINDS`).
   */
  readonly chief?: boolean;
}

/** What a Chief's panel offers: the organization's cards, its shell, its helpers and its tools. */
const CHIEF_PANEL_KINDS: ReadonlySet<RightPanelKind> = new Set([
  "overview",
  "terminal",
  "agents",
  "mcp",
]);

export interface RightPanelKindMeta {
  readonly launcher: {
    readonly label: string;
    readonly description: string;
    /** The launcher's letter: the label's first, or `null` where another page holds that one. */
    readonly shortcut: string | null;
    readonly unavailableHint: string;
  } | null;
  /**
   * The page's head (`RightPanelPage`): its title and one line saying what it shows, `mate` the
   * Mate's name or "this Mate". `null` where the page wears a head of its own.
   */
  readonly page: {
    readonly title: string;
    readonly line: (mate: string) => string;
  } | null;
  readonly availability: (input: RightPanelAvailabilityInput) => RightPanelAvailability;
}

const projectAvailability = (input: RightPanelAvailabilityInput): RightPanelAvailability =>
  input.projectOpen ? "available" : "unavailable";

export const RIGHT_PANEL_KIND_META = {
  // The organization's cards, a Chief's alone: its header's Overview opens them too.
  overview: {
    launcher: {
      label: "Overview",
      description: "Your organization's projects, side by side.",
      shortcut: "O",
      unavailableHint: "Available in your Chief's conversation.",
    },
    page: null,
    availability: (input) => (input.chief === true ? "available" : "hidden"),
  },
  browser: {
    launcher: {
      label: "Browser",
      description: "Open your app's sites.",
      shortcut: "B",
      unavailableHint: "Available in a Zerops project.",
    },
    // Its list of sites and an open site fill the panel, with no head over either (the owner,
    // 2026-10-18).
    page: null,
    availability: (input) => input.zeropsPanel,
  },
  mac: {
    launcher: {
      label: "Mac",
      description: "Watch and use the app on the paired Mac.",
      // M is MCP's, and no other letter says Mac.
      shortcut: null,
      unavailableHint: "Available in a Zerops project.",
    },
    page: { title: "Mac", line: (mate) => `The app ${mate} opened on your paired Mac.` },
    availability: (input) => input.zeropsPanel,
  },
  diff: {
    launcher: {
      label: "Diff",
      description: "See what is not committed or not on main.",
      shortcut: "D",
      unavailableHint: "Available for Git repositories.",
    },
    // A Mate's workspace is no repository of its own, but the services' checkouts below it are.
    page: {
      title: "Diff",
      line: (mate) => `What ${mate}'s code has that main does not: not committed or not pushed.`,
    },
    availability: (input) =>
      !input.serverThread
        ? "unavailable"
        : input.gitRepo === true || input.zeropsPanel === "available"
          ? "available"
          : input.gitRepo === null || input.zeropsPanel === "unknown"
            ? "unknown"
            : "unavailable",
  },
  zerops: {
    launcher: {
      label: "Zerops",
      description: "See the project's services.",
      shortcut: "Z",
      unavailableHint: "Available in a Zerops project.",
    },
    page: { title: "Zerops", line: () => "The project's services and what each one uses." },
    availability: (input) => input.zeropsPanel,
  },
  agents: {
    launcher: {
      label: "Helpers",
      description: "Follow this Mate's helpers and their work.",
      shortcut: "H",
      unavailableHint: "Available from a chat.",
    },
    page: { title: "Helpers", line: (mate) => `The helpers ${mate} starts, and their work.` },
    availability: () => "available",
  },
  crew: {
    launcher: {
      label: "Crew",
      description: "Set up a crew and follow its tasks.",
      shortcut: "C",
      unavailableHint: "Available in a Zerops project with crew mode on.",
    },
    page: { title: "Crew", line: (mate) => `Crewmates who build a job's parts beside ${mate}.` },
    availability: (input) =>
      input.zeropsPanel === "available" &&
      (input.crewStatus === "none" || input.crewStatus === "applied")
        ? "available"
        : "hidden",
  },
  files: {
    launcher: {
      label: "Files",
      description: "Browse and read workspace files.",
      shortcut: "F",
      unavailableHint: "Available when a project is open.",
    },
    page: { title: "Files", line: (mate) => `The files ${mate} works on.` },
    availability: projectAvailability,
  },
  file: {
    launcher: null,
    page: null,
    availability: projectAvailability,
  },
  git: {
    launcher: {
      label: "Git",
      description: "Follow branches and where they go.",
      shortcut: "G",
      unavailableHint: "Available in a Zerops project.",
    },
    page: {
      title: "Git",
      line: (mate) => `Where ${mate}'s code goes: branches, commits and changes.`,
    },
    availability: (input) => input.zeropsPanel,
  },
  data: {
    launcher: {
      label: "Data",
      description: "Browse databases and storage.",
      // D is Diff's, and a letter that does not start the name is never guessed.
      shortcut: null,
      unavailableHint: "Available in a Zerops project.",
    },
    page: { title: "Data", line: () => "The project's databases and storage." },
    availability: (input) => input.zeropsPanel,
  },
  vault: {
    launcher: {
      label: "Vault",
      description: "Settings and secrets your apps use.",
      shortcut: "V",
      unavailableHint: "Available in a Zerops project.",
    },
    page: { title: "Vault", line: () => "Settings and secrets your apps read." },
    availability: (input) => input.zeropsPanel,
  },
  terminal: {
    launcher: {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      shortcut: "T",
      unavailableHint: "Available when a project is open.",
    },
    page: { title: "Terminal", line: (mate) => `A shell on ${mate}'s computer.` },
    availability: projectAvailability,
  },
  mcp: {
    launcher: {
      label: "MCP",
      description: "Add and check this Mate's tools.",
      shortcut: "M",
      unavailableHint: "Available from a conversation.",
    },
    // Every Mate's agents take MCP servers; the tab asks the Mate, not Zerops.
    page: {
      title: "MCP servers",
      line: (mate) => `Tools ${mate} can use, with each of its coding agents.`,
    },
    availability: () => "available",
  },
} satisfies Record<RightPanelKind, RightPanelKindMeta>;

/** The head a side-panel page opens with; `mate` is the Mate's name while it is known. */
export function rightPanelPageHead(
  kind: RightPanelKind,
  mate: string | undefined,
): { readonly title: string; readonly line: string } | null {
  const page = RIGHT_PANEL_KIND_META[kind].page;
  return page === null ? null : { title: page.title, line: page.line(mate ?? "this Mate") };
}

/**
 * A site's tab is the site itself, edge to edge under its own address row (`ServiceBrowserPanels`),
 * in place of the Browser's list of sites.
 */
export function isRightPanelSite(
  surface: RightPanelSurface,
): surface is Extract<RightPanelSurface, { readonly url: string }> {
  return surface.kind === "browser" && "url" in surface;
}

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
    RIGHT_PANEL_KINDS.map((kind) => [
      kind,
      input.chief === true && !CHIEF_PANEL_KINDS.has(kind)
        ? "hidden"
        : RIGHT_PANEL_KIND_META[kind].availability(input),
    ]),
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
