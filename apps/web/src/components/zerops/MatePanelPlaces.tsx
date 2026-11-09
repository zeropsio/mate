/**
 * The project a Mate works in, as its Zerops and Git panels show it: the way to the project's page,
 * and the project's places as the pages draw them, each opening its own page (decision P6 of the
 * pages pass, 2026-11-09: the panels never mentioned production, stage or the project).
 *
 * Presentational: the panels' containers read the project (`useMatePanelProject`).
 */
import { ChevronRightIcon } from "lucide-react";

import { panelPlaces, projectPageWords } from "./matePanels.logic";
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
