/**
 * A harness project as the menu would have drawn it, for the surfaces that open a place's Sites
 * from the menu's own model (`useProjectSitesOfGroup`): no menu stands beside a harness page, so
 * the page's fixtures hand their places over themselves.
 *
 * Fixtures only. Nothing here ships.
 */
import type { ChipMenuStop } from "~/components/zerops/SidebarProductionChip.logic";
import type { ProjectSitesInput } from "~/components/zerops/SidebarProjectSites";
import { showProjectParts } from "~/zerops/projectPartsShown";

/** A place of a harness project: its Zerops project, its name, what it runs and where it answers. */
export interface HarnessPlace {
  readonly kind: "production" | "stage";
  readonly projectId: string;
  readonly name: string;
  readonly version?: string | undefined;
  readonly addresses: ReadonlyArray<{ readonly service: string; readonly url: string }>;
}

const stopOf = (place: HarnessPlace): ChipMenuStop => ({
  projectId: place.projectId,
  name: place.name,
  version: place.version,
  dot: "ok",
  word: "Running",
  tone: "muted",
  note: undefined,
  fix: undefined,
  routes: place.addresses.map(({ service, url }) => ({
    service,
    port: 443,
    host: new URL(url).host,
    url,
  })),
});

const drawn = new Map<string, ProjectSitesInput>();

/** Hands a harness project's places to whatever opens Sites from the menu's model. */
export function showHarnessPlaces(
  groupId: string,
  projectName: string,
  places: ReadonlyArray<HarnessPlace>,
): void {
  const of = (kind: HarnessPlace["kind"]) => {
    const stops = places.filter((place) => place.kind === kind).map(stopOf);
    return stops.length === 0 ? undefined : () => ({ stops });
  };
  drawn.set(groupId, {
    groupId,
    projectName,
    production: of("production"),
    stages: of("stage"),
    mates: [],
    prodChip: undefined,
    stageChip: undefined,
    line: undefined,
    onAskToFix: undefined,
    onOpenStop: () => undefined,
  });
  showProjectParts([...drawn.values()].map((sites) => ({ mateIds: [], sites, review: undefined })));
}
