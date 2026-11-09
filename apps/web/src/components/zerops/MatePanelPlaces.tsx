/**
 * The project a Mate works in, as its Zerops and Git panels show it: the way to the project's page,
 * and the project's places as the pages draw them, each opening its own page (decision P6 of the
 * pages pass, 2026-11-09: the panels never mentioned production, stage or the project).
 *
 * Presentational: the panels' containers read the project (`useMatePanelProject`).
 */
import { ChevronRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { panelPlaces, possessive, projectPageWords } from "./matePanels.logic";
import type { PlaceLine as PlaceLineModel } from "./projects/projectCard.logic";
import { NextRelease, PlaceLine, SectionAction, type NextReleaseInput } from "./system";

/** The Mate's project, as a panel is handed it. */
export interface MatePanelProject {
  /** Its application in HQ, which is its group: a place's name opens the place under it. */
  readonly groupId: string;
  /** What a person calls the project (its application's name). */
  readonly name: string;
  /** Its places, the pages' own lines (`useApplicationPlaces`): none while they are read. */
  readonly places: ReadonlyArray<PlaceLineModel>;
  /** What goes to production next (`NextRelease`); `null` while nothing waits or it is read. */
  readonly next: NextReleaseInput | null;
  readonly onOpenProject: () => void;
}

/** "<Project>'s page ›", the action of a panel's section label. */
export function ProjectPageLink({ project }: { readonly project: MatePanelProject }) {
  return (
    <SectionAction onClick={project.onOpenProject}>
      {projectPageWords(project.name)}
      <ChevronRightIcon aria-hidden="true" />
    </SectionAction>
  );
}

/**
 * The project's places, one compact line each, and — under them, where the Git panel says where
 * work goes — what goes to production next. Lines hold their height while the places are read.
 */
export function MatePlaces({
  project,
  panel,
}: {
  readonly project: MatePanelProject;
  readonly panel: "zerops" | "git";
}) {
  // Production is always said once read: no line at all is a read still out.
  if (project.places.length === 0)
    return (
      <div aria-hidden="true" className="grid" data-zerops-surface="panel-places-held">
        <div className="h-7" />
        <div className="h-7" />
      </div>
    );
  return (
    <div className="grid min-w-0 gap-1" data-zerops-surface="panel-places">
      {panelPlaces(project.places, panel).map((line) => (
        <PlaceLine
          density="compact"
          groupId={project.groupId}
          key={`${line.kind}:${line.projectId ?? line.name}`}
          line={line}
        />
      ))}
      {panel === "git" && project.next !== null ? (
        <div className="pt-1">
          <NextRelease density="line" {...project.next} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The project a Mate works in, atop its Zerops and Git panels: a small overview card — whose
 * project and its name with the way to its page; its places, one compact line each (production
 * with its version and address, a stage or that there is none); and what goes to production next,
 * with *Review release* where one waits. A project nothing went live in yet says so in one line,
 * with the way to put it live.
 */
export function MateProjectCard({
  project,
  mateName,
  panel = "zerops",
}: {
  readonly project: MatePanelProject;
  /** Which panel opens with it: the Git panel says what a missing stage means for the work. */
  readonly panel?: "zerops" | "git";
  /** The Mate whose panel it is, for "Dana's project"; undefined while it is not known. */
  readonly mateName: string | undefined;
}) {
  const production = project.places.find((line) => line.kind === "production");
  const notLive =
    project.places.length > 0 && (production === undefined || production.nothingDeployed === true);
  return (
    <section
      aria-label={`${project.name}, ${mateName === undefined ? "this Mate" : possessive(mateName, "project")}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card"
      data-zerops-surface="panel-project"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 pt-3.5 pb-1.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-muted-foreground">
            {mateName === undefined ? "This Mate's project" : possessive(mateName, "project")}
          </span>
          <span className="truncate text-base font-semibold text-foreground">{project.name}</span>
        </span>
        <SectionAction onClick={project.onOpenProject}>
          Open project
          <ChevronRightIcon aria-hidden="true" />
        </SectionAction>
      </div>
      {notLive ? (
        <div
          className="flex min-w-0 items-center justify-between gap-3 px-4 pt-1 pb-3.5"
          data-zerops-surface="panel-not-live"
        >
          <span className="text-body text-muted-foreground">Not live yet</span>
          <Button onClick={project.onOpenProject} size="sm" variant="secondary">
            Put it live
          </Button>
        </div>
      ) : (
        <div className="px-4 pt-1 pb-3">
          <MatePlaces panel={panel} project={project} />
        </div>
      )}
      {notLive || project.next === null ? null : (
        <div className="px-3 pb-3" data-zerops-surface="panel-next-release">
          <NextRelease density="line" {...project.next} />
        </div>
      )}
    </section>
  );
}
