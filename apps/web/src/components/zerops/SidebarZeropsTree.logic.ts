/**
 * What the left menu's Mate rows decide on their own: how long a Mate has been
 * at it, when one has gone quiet, and what a key does on its row.
 */

/**
 * How long a working Mate has been at it, as its row's clock reads: minutes
 * and seconds for the first hour, then hours and minutes. It ticks, so it
 * counts up from the turn's start rather than saying how long ago that was.
 */
export function formatWorkingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 3600)
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A week: a Mate untouched for longer folds into its project's quiet Mates. */
export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a Mate has gone quiet: resting for more than a week, nothing
 * unread, nothing waiting — and not the one whose conversation is open. A
 * Mate nobody can date (no conversation read yet) never folds: it may be
 * the busiest one there is.
 */
export function isQuietMate(
  activity:
    | {
        readonly face: string;
        readonly at: string;
        readonly unread: boolean;
      }
    | undefined,
  nowMs: number,
  active: boolean,
): boolean {
  if (activity === undefined || active || activity.unread) return false;
  if (activity.face !== "idle" && activity.face !== "done") return false;
  const at = Date.parse(activity.at);
  return Number.isFinite(at) && nowMs - at > QUIET_AFTER_MS;
}

/** What a key does on a Mate's row: j and k move, x stops it, e marks it read or unread. */
export type SidebarMateKeyAction = "next" | "previous" | "stop" | "unread";

export function sidebarMateKey(input: {
  readonly key: string;
  readonly modified: boolean;
}): SidebarMateKeyAction | undefined {
  if (input.modified) return undefined;
  switch (input.key) {
    case "j":
      return "next";
    case "k":
      return "previous";
    case "x":
    case "X":
      return "stop";
    case "e":
    case "E":
      return "unread";
    default:
      return undefined;
  }
}

/** One entry of a project heading's ···: an item, or the line between two groups. */
export type HeadingMenuEntry =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly disabled: boolean;
      /** Why an item stands off, said on it. */
      readonly why?: string | undefined;
      /** It deletes: in red. */
      readonly destructive?: boolean;
      readonly act: () => void;
    }
  | { readonly kind: "separator" };

/**
 * The place a project's Addresses opens: its production, else its first stage, else its first
 * Mate's own project; `undefined` while it has none.
 */
export function addressesPlace(input: {
  readonly production: string | undefined;
  readonly stages: ReadonlyArray<string | undefined>;
  readonly mates: ReadonlyArray<string>;
}): string | undefined {
  return [input.production, ...input.stages, ...input.mates].find((id) => id !== undefined);
}

/**
 * A project heading's ··· (round 5): Fold, Add a Mate and Open project first — the heading's own
 * verbs, none of them on it at rest — then its Addresses where it has a place, Invite people for
 * someone who may bring people in (the project picked in the invitation), then moving it
 * among the others, then adding a stage or a production it lacks, and where projects are added.
 * The New Mate dialog opens over the view on screen: Add a Mate goes nowhere. A project without a
 * Mate starts one, and offers its Delete last of all, a line apart, in red (app-lifecycle.md).
 */
export function projectHeadingMenu(input: {
  readonly collapsed: boolean;
  /** Absent where the heading does not fold. */
  readonly onToggle: (() => void) | undefined;
  readonly onAddMate: (() => void) | undefined;
  /** The project has no Mate: adding one starts it (*Start a Mate*). */
  readonly startMate?: boolean;
  /** Opens the project's Delete dialog; absent where it has a Mate or the person may not delete. */
  readonly onDelete?: { readonly name: string; readonly act: () => void } | undefined;
  /** Opens *Add automated Mates* for the project; absent where HQ makes none or none may be added. */
  readonly onAddAutomatedMates?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press (`newMateGate`); Add stands off. */
  readonly addMateWhy?: string | null | undefined;
  readonly onOpen: () => void;
  /** Opens the addresses sheet for its place (`addressesPlace`); absent while it has none. */
  readonly onAddresses?: (() => void) | undefined;
  /** Opens the invitation with this project picked; absent for someone who may not invite. */
  readonly onInvite?: (() => void) | undefined;
  readonly reorder:
    | {
        readonly canMoveUp: boolean;
        readonly canMoveDown: boolean;
        readonly onMove: (direction: "up" | "down") => void;
      }
    | undefined;
  /** "Add stage", "Put it live": what the project lacks, each opening its form or its sheet. */
  readonly setUp: ReadonlyArray<{ readonly label: string; readonly act: () => void }>;
  readonly onBrowseProjects: () => void;
}): ReadonlyArray<HeadingMenuEntry> {
  const item = (label: string, act: () => void, disabled = false): HeadingMenuEntry => ({
    kind: "item",
    label,
    disabled,
    act,
  });
  const separator: HeadingMenuEntry = { kind: "separator" };
  const { reorder, onDelete } = input;
  const addLabel = input.startMate === true ? "Start a Mate" : "Add a project Mate";
  return [
    ...(input.onToggle === undefined
      ? []
      : [item(input.collapsed ? "Unfold" : "Fold", input.onToggle)]),
    ...(input.onAddMate === undefined
      ? []
      : input.addMateWhy == null
        ? [item(addLabel, input.onAddMate)]
        : [
            {
              kind: "item" as const,
              label: addLabel,
              disabled: true,
              why: input.addMateWhy,
              act: input.onAddMate,
            },
          ]),
    ...(input.onAddAutomatedMates === undefined
      ? []
      : input.addMateWhy == null
        ? [item("Add automated Mates…", input.onAddAutomatedMates)]
        : [
            {
              kind: "item" as const,
              label: "Add automated Mates…",
              disabled: true,
              why: input.addMateWhy,
              act: input.onAddAutomatedMates,
            },
          ]),
    item("Open project", input.onOpen),
    ...(input.onAddresses === undefined ? [] : [item("Addresses", input.onAddresses)]),
    ...(input.onInvite === undefined ? [] : [item("Invite people", input.onInvite)]),
    separator,
    ...(reorder === undefined
      ? []
      : [
          item("Move up", () => reorder.onMove("up"), !reorder.canMoveUp),
          item("Move down", () => reorder.onMove("down"), !reorder.canMoveDown),
          separator,
        ]),
    ...input.setUp.map(({ label, act }) => item(label, act)),
    item("All projects", input.onBrowseProjects),
    ...(onDelete === undefined
      ? []
      : [
          separator,
          {
            kind: "item" as const,
            label: `Delete ${onDelete.name}…`,
            disabled: false,
            destructive: true,
            act: onDelete.act,
          },
        ]),
  ];
}
