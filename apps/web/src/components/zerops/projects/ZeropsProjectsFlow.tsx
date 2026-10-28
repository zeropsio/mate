/**
 * The overview (round 5, "Mate Clean Overview"): a card per project with Mates, side by side —
 * its name and address, its Mates, a release ready to go and production's one line
 * (`ProjectCards`); then the projects without a Mate as lines, each its name and production's
 * line; the containers no project holds as one folded group; and the organization's HQ as the
 * quiet line at the end.
 *
 * Structural only: every Mate row, verb, menu and panel is an injected slot the page fills (R5),
 * and what a card says is `groupFlow`'s and `projectCard.logic`'s. An account with no project yet
 * gets the invitation instead.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  ZeropsEnvironmentRole,
  ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../ui/button";
import { MateFace, type MateFaceSize } from "../primitives";
import { firstRunWords } from "./firstRun.logic";
import type { ProductionChip } from "../SidebarProductionChip.logic";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { OverviewCardsStandIn } from "./OverviewStandIn";
import { OtherContainers, OtherProjects } from "./ProjectList";
import { ProjectCards, ProjectPage } from "./ProjectCards";
import type { PlaceLine } from "./projectCard.logic";
import type { ChangesUnknown, RowMateActivity } from "./projectsView.logic";

/** One group as the page lays it out: its flow and the carriers the slots draw. */
/** A stage being added, as its card's Stage line says it. */
export interface StageSettingUp {
  /** The step under way, in words; `undefined` before its plan is known. */
  readonly step: string | undefined;
  /** When the adding began; `null` before its first step started. */
  readonly startedAtMs: number | null;
}

export interface ProjectsFlowGroup<T> {
  readonly group: Omit<ZeropsGroup, "environments" | "production"> & {
    readonly environments: ReadonlyArray<{ readonly role: ZeropsEnvironmentRole | undefined }>;
  };
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
    { readonly item: T | undefined; readonly role: ZeropsEnvironmentRole | undefined }
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

/**
 * A project's own page: its card at the page's width, every Mate unfolded, and the page's own
 * column beside it — the people on it, its environments, its repositories and its history.
 */
export interface ProjectPageSlot {
  readonly groupId: string;
  /** The column beside the card. */
  readonly aside: ReactNode;
  /** *Add a Mate*, at the foot of its Mates. */
  readonly onAddMate?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press: *Add a Mate* stands off with it. */
  readonly addMateWhy?: string | null;
  /** Who can work on it, and how — under its Mates on the card. */
  readonly people?: ReactNode;
  /** What the page says while the project is not among the read ones yet. */
  readonly unread: ReactNode;
}

export interface ZeropsProjectsFlowProps<T> {
  /** In the page's order. */
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  /** The projects no group holds, with the one verb each row offers. */
  /** Source coverage for rows whose HQ placement has not been read. */
  readonly placementNotice?: string | undefined;
  /**
   * Placement is only on its way — no refusal, no outage: an account not started yet says nothing
   * for the beat it takes, so a reload paints no words it takes back.
   */
  readonly placementReading?: boolean | undefined;
  readonly ungrouped: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly getKey: (item: T) => string;
  readonly isMate: (item: T) => boolean;
  /**
   * A Mate — a `card` of its own among the containers no project holds, or a `row` on its
   * project's card (`CardMate`), with its change waiting for review (`review`) where it has one.
   */
  readonly renderMate: (
    item: T,
    options: {
      readonly layout: "card" | "row";
      readonly parts: ReadonlyArray<MatePart>;
      readonly review?: FlowPullRequest | undefined;
    },
  ) => ReactNode;
  /** A Mate's face, beside its name in a row. */
  readonly renderMateFace: (item: T, size: MateFaceSize) => ReactNode;
  /**
   * How a Mate opens into its conversation, wherever the list names it;
   * `undefined` where it cannot open yet (coming up, busy), and the name is
   * then still.
   */
  readonly openMate: (item: T) => (() => void) | undefined;
  /** An environment's row — a `ZeropsEnvironmentRow`. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** The ready release's door on a card (*Review release*), while one is offered. */
  readonly renderReleaseVerb?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** The row's ··· menu: the project's quiet verbs, and its Mates' previews (`flow.mates`). */
  readonly renderGroupMenu: (entry: ProjectsFlowGroup<T>) => ReactNode;
  /** Re-probes the containers not answering. */
  readonly onRetryContainers: (items: ReadonlyArray<T>) => void;
  /** A creation runs: every add verb is disabled, never hidden. */
  readonly creating?: boolean;
  /** The organization's HQ, the page's quiet end (`ZeropsHqCard`). */
  readonly hqCard: ReactNode;
  /** Starts the account's first project, where the viewer's role creates projects. */
  readonly onCreateProject?: (() => void) | undefined;
  /** The account has no project yet: its first screen says why, by the role (`firstRunWords`). */
  readonly noProjectYet?: boolean | undefined;
  /** The viewer's role reaches every project by itself; below Read only, only what it is given. */
  readonly reachesEveryProject?: boolean | undefined;
  /** The group whose card scrolls into view and pulses (`?group=`). */
  readonly focusGroup?: string | undefined;
  /**
   * What the menu's chips say of a project's places (`productionChip`), where the page has read
   * them; without it a card's foot says what the flow says.
   */
  readonly cardPlaces?:
    | ((entry: ProjectsFlowGroup<T>) => {
        readonly chip?: ProductionChip | undefined;
        readonly stageChips?: ReadonlyMap<string, ProductionChip | undefined> | undefined;
        readonly since?: string | undefined;
        readonly down?: ReadonlyMap<string, ReadonlyArray<string>> | undefined;
        /** Whether each stage has a publication in progress (`placeLines`). */
        readonly addressPending?: ReadonlyMap<string, boolean> | undefined;
        /** The release on its way rolls production back to this one (`placeLines`). */
        readonly rollsBackTo?: string | undefined;
        /** The stage runs every change a release would carry; `undefined` while unread. */
        readonly releaseOnStage?: boolean | undefined;
        /** When this tab's run began releasing (wall ms): production's line counts from it. */
        readonly releaseSince?: number | undefined;
      })
    | undefined;
  /** A place's panel: its facts and its actions; without it, its line. */
  readonly renderPlacePanel?:
    | ((entry: ProjectsFlowGroup<T>, line: PlaceLine) => ReactNode)
    | undefined;
  /**
   * A release or *Put it live* run on the project's production (`ProductionRun`): under way, live
   * for a while, or stopped with its one action — the project's, never a Mate's conversation's.
   */
  readonly renderProductionRun?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** A project's latest changes, open and merged (`cardChanges`); without it, none. */
  readonly renderChanges?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** A project page's History: its releases, each with what it put live (`historyReleases`). */
  readonly renderHistory?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /**
   * Sets up a project's production, where it has none and HQ offers it to this person: its card
   * offers it where production is said (the owner, 2026-10-12: "why instead of 'no production'
   * empty state not have a button to setup prod"). `"busy"` while another environment is being
   * set up: the button stays, not to be pressed.
   */
  readonly setUpProduction?:
    | ((entry: ProjectsFlowGroup<T>) => (() => void) | "busy" | undefined)
    | undefined;
  /**
   * Adds a stage to a project that has none, where HQ offers it to this person: its card offers it
   * where the stage would stand (the onboarding run's owner searched 21 s for it in the card's
   * ··· menu). `"busy"` while another environment is being set up.
   */
  readonly setUpStage?:
    | ((entry: ProjectsFlowGroup<T>) => (() => void) | "busy" | undefined)
    | undefined;
  /**
   * A stage this page is adding to a project, while it is: the step under way and when the adding
   * began (`creationNow`), said on the card's Stage line, where the stage stands — never in a card
   * of its own at the page's foot.
   */
  readonly stageSettingUp?:
    | ((entry: ProjectsFlowGroup<T>) => StageSettingUp | undefined)
    | undefined;
  /**
   * *Add a Mate* at the foot of a card's Mates, where the person may add one — and why it stands
   * off where that is known before the press.
   */
  readonly addMate?:
    | ((
        entry: ProjectsFlowGroup<T>,
      ) => { readonly onAdd: () => void; readonly why: string | null } | undefined)
    | undefined;
  /** The people on a project, beside its name, where more than one. */
  readonly renderCardPeople?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** One project's own page in place of the overview (`ProjectPageSlot`). */
  readonly page?: ProjectPageSlot | undefined;
}

/**
 * First run owns the page: to an account that has nothing in it yet this is
 * the whole screen, not a card under a list header — the Mate's face large,
 * one line saying what a Mate is, and the one filled button.
 */
function FirstRun({
  onCreateProject,
  creating,
  reachesEveryProject,
}: {
  readonly onCreateProject: (() => void) | undefined;
  readonly creating: boolean;
  readonly reachesEveryProject: boolean;
}) {
  const words = firstRunWords({ create: onCreateProject !== undefined, reachesEveryProject });
  return (
    <section
      className="flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-6"
      data-zerops-surface="first-run"
    >
      <MateFace className="size-20" size={64} state="idle" tint="slate" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{words.heading}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{words.body}</p>
      </div>
      {words.newProject && onCreateProject !== undefined ? (
        <Button disabled={creating} onClick={onCreateProject}>
          <PlusIcon aria-hidden="true" />
          New project
        </Button>
      ) : null}
    </section>
  );
}

/** What a container outside every project shows on the overview for: it needs the person. */
const CONTAINER_NEEDS_PERSON: ReadonlySet<ZeropsRowAction["kind"]> = new Set([
  "retry-probe",
  "start",
  "restart",
]);

export function ZeropsProjectsFlow<T>(props: ZeropsProjectsFlowProps<T>) {
  const { groups, ungrouped, creating = false, onCreateProject, focusGroup, page } = props;
  if (page !== undefined) {
    const entry = groups.find((candidate) => candidate.group.groupId === page.groupId);
    return (
      <div
        aria-label="Project"
        className="@container/flow flex flex-col gap-4"
        data-zerops-surface="projects-flow"
        role="region"
      >
        {entry === undefined ? (
          page.unread
        ) : (
          <ProjectPage
            aside={page.aside}
            entry={entry}
            addMateWhy={page.addMateWhy ?? null}
            onAddMate={page.onAddMate}
            people={page.people}
            props={props}
          />
        )}
      </div>
    );
  }
  // The organization's HQ is not a project, so an account holding nothing
  // but its HQ has still not started.
  const started = groups.length > 0 || ungrouped.length > 0;
  const firstRun =
    (onCreateProject !== undefined || props.noProjectYet === true) &&
    !started &&
    props.placementNotice === undefined;
  // Containers no project holds are the organization's inner workings, and HQ is Settings': the
  // overview names a container only while it needs the person — not answering, stopped.
  const containers = ungrouped.filter((row) => CONTAINER_NEEDS_PERSON.has(row.action));
  // With nothing drawn, why: placement still on its way says so once it takes a beat — never on a
  // quick reload — and HQ's trouble says so at once, with HQ's card.
  const empty = groups.length === 0 && containers.length === 0;

  return (
    <div
      aria-label="Projects"
      // The list sizes itself to its own width, not the window's: the left
      // menu takes a share of the window the page never gets.
      className="@container/flow flex flex-col gap-4"
      data-zerops-surface="projects-flow"
      role="region"
    >
      {!empty || props.placementNotice === undefined ? null : props.placementReading === true ? (
        <OverviewCardsStandIn />
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {props.placementNotice}
          </p>
          {props.hqCard}
        </>
      )}
      {firstRun ? (
        <FirstRun
          creating={creating}
          onCreateProject={onCreateProject}
          reachesEveryProject={props.reachesEveryProject ?? true}
        />
      ) : null}
      <ProjectCards
        focusGroup={focusGroup}
        groups={groups.filter((entry) => entry.flow.mates.length > 0)}
        props={props}
      />
      <OtherProjects
        groups={groups.filter((entry) => entry.flow.mates.length === 0)}
        props={props}
      />
      <OtherContainers props={props} rows={containers} />
    </div>
  );
}
