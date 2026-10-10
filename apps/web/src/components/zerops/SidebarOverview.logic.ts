/**
 * The Overview row's second line: the organization in one plain sentence, as the overview page
 * opens on it. The first rule that applies: a project whose production or stage failed or is down,
 * then a release on its way, then how many projects run.
 */
import type { GroupEnvironmentTier, GroupRowTone } from "@t3tools/client-runtime/zerops";

import type { StopServing } from "./SidebarProductionChip.logic";

/** One project as the headline weighs it. */
export interface OverviewProject {
  readonly name: string;
  /** Its production or a stage failed or is down. */
  readonly attention: boolean;
  /** A release is on its way to its production. */
  readonly releasing: boolean;
}

export function overviewHeadline(projects: ReadonlyArray<OverviewProject>): string {
  const troubled = projects.filter((project) => project.attention);
  const [first] = troubled;
  if (first !== undefined) {
    const more = troubled.length - 1;
    return `${first.name} needs attention${more > 0 ? ` · ${String(more)} more` : ""}`;
  }
  const releasing = projects.find((project) => project.releasing);
  if (releasing !== undefined) return `Releasing ${releasing.name}…`;
  if (projects.length === 0) return "No projects yet";
  return `${String(projects.length)} project${projects.length === 1 ? "" : "s"}, all running`;
}

/** The places a person manages: a dev's trouble is its Mate's work, not the headline's. */
const MANAGED: ReadonlySet<GroupEnvironmentTier> = new Set(["stage", "production"]);

export function overviewProjectOf(input: {
  readonly name: string;
  /** Each environment: its tier, its last deploy's tone, and how the platform says it serves. */
  readonly environments: ReadonlyArray<{
    readonly tier: GroupEnvironmentTier;
    readonly tone: GroupRowTone;
    readonly serving: StopServing["kind"];
  }>;
  /** A release newer than what production runs did not go through (`releaseFailureOf`). */
  readonly releaseFailed: boolean;
  readonly releasing: boolean;
}): OverviewProject {
  const attention =
    input.releaseFailed ||
    input.environments.some(
      (environment) =>
        MANAGED.has(environment.tier) &&
        (environment.tone === "bad" || environment.serving === "down"),
    );
  return { name: input.name, attention, releasing: input.releasing };
}

/**
 * ⌥0 selects Overview, wherever the focus is but a field: by the key's place, since ⌥0 types a
 * character on a Mac keyboard.
 */
export function overviewKeyPressed(event: {
  readonly code: string;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  /** The key was typed into a field, whose key it is. */
  readonly typing: boolean;
}): boolean {
  return (
    event.code === "Digit0" &&
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.typing
  );
}
