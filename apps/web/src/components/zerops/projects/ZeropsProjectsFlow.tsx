/**
 * The projects page, one dense list: a row per project, at most two lines — its name, its Mates by
 * face and full name and production's version where production runs one; then the one thing that
 * needs the person as a full sentence, its single verb at the row's end, else the latest
 * meaningful fact (`projectRowLine`). Rows that need the person rise first, the person's own
 * order kept within (`risenFirst`). A row opens into the project's detail: its Mates' last words,
 * its pull requests, its environments and its releases. The containers no project holds are one
 * folded group at the end, and the organization's HQ is the quiet line under it.
 *
 * Structural only: every card, row, verb and menu is an injected slot the page fills (R5), and
 * what a row says is `groupFlow`'s and `projectsView.logic`'s. An account with no project yet
 * gets the invitation instead of the list.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  ZeropsEnvironmentRole,
  ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import type { ReactNode } from "react";

import { MateFace, Pill } from "../primitives";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { OtherContainers, ProjectList, QuietEnd } from "./ProjectList";
import type { ChangesUnknown, RowMateActivity } from "./projectsView.logic";

/** One group as the page lays it out: its flow and the carriers the slots draw. */
export interface ProjectsFlowGroup<T> {
  readonly group: ZeropsGroup;
  readonly flow: GroupFlow;
  /** What HQ holds of it (`applicationContents`): a deletion under way, records left. */
  readonly contents?: HqAppContents | undefined;
  /** Its Mates' activity, HQ's word or their sockets', as the row's line reads it (`projectRowLine`). */
  readonly activities: ReadonlyArray<RowMateActivity>;
  /** Why its changes are not known, where they are not: the row says so (`projectRowLine`). */
  readonly changesUnknown?: ChangesUnknown | undefined;
  /**
   * Unread, and its read is out: its line holds a skeleton rather than a
   * claim. False for a group nobody will read (the organization's HQ not
   * known), whose line says what is known.
   */
  readonly awaiting: boolean;
  /**
   * Its changes are unread and their read is out (`flowStepsAwaiting`): its pull requests and
   * `main` hold a skeleton, whatever its deploys already say.
   */
  readonly changesAwaiting: boolean;
  /** The Mates' environments by project id, in the tree's order (`matesOf` pairs them). */
  readonly mates: ReadonlyMap<string, T>;
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
  /** In the page's order. */
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  /** The projects no group holds, with the one verb each row offers. */
  readonly ungrouped: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly getKey: (item: T) => string;
  readonly isMate: (item: T) => boolean;
  /**
   * A Mate — a `ZeropsMateCard` with every verb it has: a `card` of its own,
   * or a `row` in a project card's Mates step, its Preview on its first line.
   */
  readonly renderMate: (
    item: T,
    options: { readonly layout: "card" | "row"; readonly preview: string | undefined },
  ) => ReactNode;
  /** A Mate's face, beside its name in a row. */
  readonly renderMateFace: (item: T, size: "sm" | "md") => ReactNode;
  /**
   * How a Mate opens into its conversation, wherever the list names it;
   * `undefined` where it cannot open yet (coming up, busy), and the name is
   * then still.
   */
  readonly openMate: (item: T) => (() => void) | undefined;
  /** An environment's row — a `ZeropsEnvironmentRow`. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /**
   * A pull request's `<li>`. `withMerge` is false where the step's own verb
   * already merges it; `review` is whether it shows its *Review* at all
   * (`changeShowsReview`); `compact` stacks it for a step's narrow column.
   */
  readonly renderPullRequest: (
    group: ZeropsGroup,
    pull: FlowPullRequest,
    options: {
      readonly withMerge: boolean;
      readonly review: boolean;
      readonly compact: boolean;
    },
  ) => ReactNode;
  /** The verb of a group's next step (`flow.nextStep`), at its row's end; nothing for `none`. */
  readonly renderNextStep: (entry: ProjectsFlowGroup<T>) => ReactNode;
  /**
   * *Release*, in an opened row whenever one is offered — even where the
   * ranked next step is something else, such as the production's own failed
   * deploy (D28): the release that might clear it stays in reach rather than
   * only the build. Absent where the next step already is the release, so the
   * row never shows the same verb twice.
   */
  readonly renderReleaseVerb?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** The group's releases and the release gate's reason, as `<li>`s; `null` for none. */
  readonly renderGroupRows: (group: ZeropsGroup) => ReactNode;
  /** The row's ··· menu: the project's quiet verbs, and its Mates' previews (`flow.mates`). */
  readonly renderGroupMenu: (entry: ProjectsFlowGroup<T>) => ReactNode;
  /** Re-probes the containers not answering. */
  readonly onRetryContainers: (items: ReadonlyArray<T>) => void;
  /** A creation runs: every add verb is disabled, never hidden. */
  readonly creating?: boolean;
  /** The organization's HQ, the page's quiet end (`ZeropsHqCard`). */
  readonly hqCard: ReactNode;
  /** Starts the account's first project; absent leaves an empty account empty. */
  readonly onCreateProject?: (() => void) | undefined;
  /** The group whose row opens and scrolls into view (`?group=`). */
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
          back to. Name a project and it is up in a few minutes, your team's HQ before it.
        </p>
      </div>
      <Pill disabled={creating} label="New project" onClick={onCreateProject} />
    </section>
  );
}

export function ZeropsProjectsFlow<T>(props: ZeropsProjectsFlowProps<T>) {
  const { groups, ungrouped, creating = false, onCreateProject, focusGroup } = props;
  // The organization's HQ is not a project, so an account holding nothing
  // but its HQ has still not started.
  const started = groups.length > 0 || ungrouped.length > 0;
  const firstRun = onCreateProject !== undefined && !started;

  return (
    <div
      aria-label="Projects"
      // The list sizes itself to its own width, not the window's: the left
      // menu takes a share of the window the page never gets.
      className="@container/flow flex flex-col gap-4"
      data-zerops-surface="projects-flow"
      role="region"
    >
      {firstRun ? <FirstRun creating={creating} onCreateProject={onCreateProject} /> : null}
      <ProjectList focusGroup={focusGroup} groups={groups} props={props} />
      <OtherContainers props={props} rows={ungrouped} />
      {started ? <QuietEnd props={props} /> : null}
    </div>
  );
}
