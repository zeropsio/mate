/**
 * The projects page, laid out around the one flow a project's code travels:
 * Mates (with their preview) → pull requests → `main` → production, a group
 * stage as an optional side branch of `main`, drawn only where one exists
 * (the owner, 2026-09-23 — "extremely important findings the whole UI should
 * be built around").
 *
 * Two views over the same `groupFlow`s:
 *
 * - **Overview** — a "Next steps" strip across the groups, then one row per
 *   group with work on it, the steps as columns and the verb in the cell it
 *   belongs to; a row opens to the Mates' last words and what a release would
 *   carry. A group with only a Mate nobody has spoken to is a tile; the
 *   containers no project holds are one line with their states.
 * - **Projects** — every group as a card, its four steps side by side.
 *
 * Structural only, like the tree it replaced: every card, row, verb and menu
 * is an injected slot the page fills (R5), and what each step says is
 * `groupFlow`'s and `projectsView.logic`'s. An account with no project yet
 * gets the invitation instead of the shape.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  ZeropsEnvironmentRole,
  ZeropsGroup,
  ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useRef, type ReactNode } from "react";

import { MateFace, Pill } from "../primitives";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { NextStepsStrip, OnlyAMate, OtherContainers, Overview, QuietEnd } from "./OverviewView";
import { foldGroups, foldUngrouped } from "./projectsView.logic";
import { ProjectCard } from "./ProjectsView";

/** One group as the page lays it out: its flow and the carriers the slots draw. */
export interface ProjectsFlowGroup<T> {
  readonly group: ZeropsGroup;
  readonly flow: GroupFlow;
  /** Its project flow was read. Unread is not empty. */
  readonly read: boolean;
  /** The Mates' environments, in the tree's order. */
  readonly mates: ReadonlyArray<T>;
  /** Its stages and its production, by project id. */
  readonly stops: ReadonlyMap<
    string,
    { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined }
  >;
  /** Anything else it holds — a dev box without a Mate, a dev/stage. */
  readonly others: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>;
  /** The newest code change that landed, which `main`'s step names. */
  readonly lastMerged: FlowPullRequest | undefined;
  /** The group's one line about itself — no name yet, or being set up. */
  readonly line: string | undefined;
  readonly placeholder: boolean;
}

export interface ZeropsProjectsFlowProps<T> {
  readonly view: "overview" | "projects";
  /** In the page's order. */
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  /** The projects no group holds, with the one verb each row offers. */
  readonly ungrouped: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly tools: ReadonlyArray<{ readonly item: T; readonly kind: ZeropsToolKind }>;
  readonly getKey: (item: T) => string;
  readonly isMate: (item: T) => boolean;
  /** A Mate's card — a `ZeropsMateCard` with every verb it has. */
  readonly renderMate: (item: T) => ReactNode;
  /** A Mate's face: `sm` beside its name in a row, `md` on a tile. */
  readonly renderMateFace: (item: T, size: "sm" | "md") => ReactNode;
  /**
   * How a Mate opens into its conversation, wherever the flow names it — a
   * row's Mates, a tile; `undefined` where it cannot open yet (coming up,
   * busy), and the name is then still.
   */
  readonly openMate: (item: T) => (() => void) | undefined;
  /** An environment's row — a `ZeropsEnvironmentRow`. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** A stage's or the production's own menu — its public access. */
  readonly renderStopMenu: (item: T) => ReactNode;
  /**
   * A pull request's `<li>`. `withMerge` is false where the step's own verb
   * already merges it; `compact` stacks it for a step's narrow column.
   */
  readonly renderPullRequest: (
    group: ZeropsGroup,
    pull: FlowPullRequest,
    options: { readonly withMerge: boolean; readonly compact: boolean },
  ) => ReactNode;
  /** The verb of a group's next step (`flow.nextStep`); nothing for `none`. */
  readonly renderNextStep: (entry: ProjectsFlowGroup<T>) => ReactNode;
  /**
   * *Release*, drawn in the production cell whenever one is offered — even
   * where the ranked next step is something else, such as the production's
   * own failed deploy (D28): the release that might clear it stays visible
   * rather than only the build. Absent where the next step already is the
   * release, so the cell never shows the same verb twice.
   */
  readonly renderReleaseVerb?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** The group's releases, the release gate's reason and its recipe changes, as `<li>`s; `null` for none. */
  readonly renderGroupRows: (group: ZeropsGroup) => ReactNode;
  readonly renderGroupMenu: (group: ZeropsGroup) => ReactNode;
  readonly renderTool: (item: T, kind: ZeropsToolKind) => ReactNode;
  /** Re-probes the containers not answering. */
  readonly onRetryContainers: (items: ReadonlyArray<T>) => void;
  /** Absent hides every add verb. */
  readonly onCreateEnvironment?: (groupId: string, role: ZeropsEnvironmentRole) => void;
  /** Whether a group is ready for more — its first Mate is up. Absent offers always. */
  readonly addsOffered?: (group: ZeropsGroup) => boolean;
  /** A creation runs: every add verb is disabled, never hidden. */
  readonly creating?: boolean;
  readonly onCreateTool?: () => void;
  /** Starts the account's first project; absent leaves an empty account empty. */
  readonly onCreateProject?: (() => void) | undefined;
  /** The group whose card the Projects view scrolls to. */
  readonly focusGroup?: string | undefined;
}

/**
 * First run owns the page: to an account that has nothing in it yet this is
 * the whole screen, not a card under a list header — the Mate's face large,
 * one line saying what a Mate is, and the one filled button.
 */
function FirstRun({
  onCreateProject,
  creating,
}: {
  readonly onCreateProject: () => void;
  readonly creating: boolean;
}) {
  return (
    <section
      className="flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-6"
      data-zerops-surface="first-run"
    >
      <MateFace className="size-20" size="lg" state="idle" tint="slate" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Start a project</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          A Mate is a coding agent with a dev environment of its own and one conversation you come
          back to. Name a project and it is up in a few minutes, Git hosting alongside.
        </p>
      </div>
      <Pill disabled={creating} label="New project" onClick={onCreateProject} />
    </section>
  );
}

export function ZeropsProjectsFlow<T>(props: ZeropsProjectsFlowProps<T>) {
  const { view, groups, ungrouped, creating = false, onCreateProject, focusGroup } = props;
  const folded = foldGroups(groups);
  const loose = foldUngrouped(ungrouped);
  // A tool is not a project, so an account holding nothing but Gitea has
  // still not started.
  const started = groups.length > 0 || ungrouped.length > 0;
  const firstRun = onCreateProject !== undefined && !started;

  // `?group=` scrolls its card into view once, when the card is first there.
  const scrolledTo = useRef<string | undefined>(undefined);
  const cardShown =
    view === "projects" && groups.some((entry) => entry.group.groupId === focusGroup);
  useEffect(() => {
    if (!cardShown || focusGroup === undefined || scrolledTo.current === focusGroup) return;
    scrolledTo.current = focusGroup;
    document.getElementById(`project-${focusGroup}`)?.scrollIntoView({ block: "start" });
  }, [cardShown, focusGroup]);

  return (
    <div
      aria-label="Projects and their flow"
      // The flow sizes itself to its own width, not the window's: the left
      // menu takes a share of the window the page never gets.
      className="@container/flow flex flex-col gap-4"
      data-zerops-surface="projects-flow"
      data-zerops-view={view}
      role="region"
    >
      {firstRun ? <FirstRun creating={creating} onCreateProject={onCreateProject} /> : null}
      {view === "overview" ? (
        <>
          <NextStepsStrip entries={folded.nextSteps} />
          <Overview active={folded.active} props={props} />
          <OnlyAMate entries={folded.early} props={props} />
        </>
      ) : (
        <>
          {folded.active.map((entry) => (
            <ProjectCard entry={entry} key={entry.group.groupId} props={props} />
          ))}
          <OnlyAMate entries={folded.early} props={props} />
        </>
      )}
      <OtherContainers props={props} rows={loose.containers} />
      {started ? <QuietEnd props={props} withoutMate={loose.withoutMate} /> : null}
    </div>
  );
}
