/**
 * What the left menu's stop rows measure themselves by, derived from one
 * project's flow as the provider holds it (`ZeropsProjectFlow`) — so the tree
 * is handed numbers, not the reads they come from.
 *
 * Nothing here reads anything: `main`'s heads, what each service runs and the
 * changes waiting are already in the flow, and each stop is placed among them
 * (`stopDistance.ts`, the owner, 2026-09-25).
 */
import {
  productionDistance,
  releaseDeploys,
  stageDistance,
  stageMarks,
  stageStandings,
  type EnvironmentRow,
  type GroupEnvironmentRowInput,
  type ServiceChanges,
  type StageMark,
  type StopDistance,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

/** What the tree needs to say how far each stop is from `main`. */
export interface SidebarStopReads {
  /** By Zerops project id; a stop nothing places is absent — shown as nothing, never guessed. */
  readonly distances: ReadonlyMap<string, StopDistance>;
  /** Where each change production does not run stands on the stage, by lower-case sha. */
  readonly stageMarks: ReadonlyMap<string, StageMark>;
}

/**
 * Each stop's distance from `main`, and the marks the list under production
 * wears. The stage the marks are read from is the first that follows `main`
 * and nothing else: a branch-fed stage runs work `main` does not have, so
 * whether it ran a change says nothing about the change on `main`.
 */
export function sidebarStopReads(input: {
  readonly flow: {
    readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
    readonly environments: ReadonlyArray<EnvironmentRow>;
    readonly mainHeads: ReadonlyMap<string, string>;
    readonly release: { readonly contents: ReadonlyArray<ServiceChanges> };
  };
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
}): SidebarStopReads {
  const { flow, deployments } = input;
  const contents = flow.release.contents;
  const { mainHeads } = flow;
  const production = releaseDeploys(flow.environmentInputs).production;
  const sourceOf = (projectId: string) =>
    flow.environments.find((row) => row.projectId === projectId)?.source;
  const distances = new Map<string, StopDistance>();
  let marked: ReturnType<typeof stageStandings> | undefined;
  for (const environment of flow.environmentInputs) {
    const { projectId } = environment;
    if (environment.tier === "production") {
      const distance = productionDistance({ contents, mainHeads });
      if (distance !== undefined) distances.set(projectId, distance);
      continue;
    }
    const source = sourceOf(projectId);
    const standings = stageStandings({ environment, deployment: deployments?.get(projectId) });
    if (source === "main" && marked === undefined) marked = standings;
    const distance = stageDistance({
      source,
      stage: standings.runs,
      mainHeads,
      production,
      contents,
    });
    if (distance !== undefined) distances.set(projectId, distance);
  }
  return {
    distances,
    stageMarks: stageMarks({ contents, mainHeads, stage: marked }),
  };
}

/** The words a stop's name can be and still say only its role, by role tag. */
const ROLE_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  prod: ["prod", "production"],
  stage: ["stage"],
};

/**
 * Whether a stop's own name only repeats the role its pill says — then the
 * pill says it alone. Any more than the role stays: `stage 2` beside `stage`
 * is what tells two stages apart, and `qa` or `eu-west` says where (the
 * owner, 2026-09-25). Stricter than a prefix match on purpose.
 */
export function stopNameSaysOnlyRole(tag: string | null, name: string): boolean {
  if (tag === null) return false;
  return (ROLE_NAMES[tag] ?? [tag]).includes(name.trim().toLocaleLowerCase());
}

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
