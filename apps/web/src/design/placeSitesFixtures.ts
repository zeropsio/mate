/**
 * A harness project as the menu would have drawn it, for the surfaces that open a place's Sites
 * from the menu's own model (`useProjectSitesOfGroup`): no menu stands beside a harness page, so
 * the page's fixtures hand their places over themselves.
 *
 * Fixtures only. Nothing here ships.
 */
import {
  outsideProductionMenu,
  type ChipMenuStop,
} from "~/components/zerops/SidebarProductionChip.logic";
import type { ProjectSitesInput, SitesMate } from "~/components/zerops/SidebarProjectSites";
import { showProjectParts } from "~/zerops/projectPartsShown";
import { MATE_SHAPE_OF_TINT, type MateTintId } from "@t3tools/shared/brand";

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

/** A Mate of a harness project, as its Sites list reads it: its services and where each answers. */
export interface HarnessSitesMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly hostnames: ReadonlyArray<string>;
  readonly pools: ReadonlyArray<string>;
  readonly routes: ReadonlyArray<{ readonly service: string; readonly url: string }>;
}

const mateOf = (groupId: string, mate: HarnessSitesMate): SitesMate => ({
  candidate: {
    key: `${mate.projectId}:zcp`,
    project: {
      id: mate.projectId,
      name: mate.name,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: groupId, appName: groupId, kind: "mate", mate: { face: "" } },
    },
    group: "connected",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    routes: mate.routes.map(({ service, url }) => ({
      service,
      port: 443,
      host: new URL(url).host,
      url,
    })),
    services: { hostnames: mate.hostnames, pools: mate.pools },
  } as unknown as SitesMate["candidate"],
  tint: mate.tint,
  shape: MATE_SHAPE_OF_TINT[mate.tint],
  mine: true,
  threadKey: undefined,
  name: mate.name,
  owner: undefined,
});

const drawn = new Map<string, ProjectSitesInput>();

/** Hands a harness project's places to whatever opens Sites from the menu's model. */
export function showHarnessPlaces(
  groupId: string,
  projectName: string,
  places: ReadonlyArray<HarnessPlace>,
  mates: ReadonlyArray<HarnessSitesMate> = [],
  /** Production deployed outside Mate, at the address somebody gave (`outsideProductionMenu`). */
  outsideAddress: string | null = null,
): void {
  const of = (kind: HarnessPlace["kind"]) => {
    const stops = places.filter((place) => place.kind === kind).map(stopOf);
    return stops.length === 0 ? undefined : () => ({ stops });
  };
  drawn.set(groupId, {
    groupId,
    projectName,
    production:
      of("production") ??
      (outsideAddress === null ? undefined : () => outsideProductionMenu(outsideAddress)),
    stages: of("stage"),
    mates: mates.map((mate) => mateOf(groupId, mate)),
    prodChip: undefined,
    stageChip: undefined,
    line: undefined,
    onAskToFix: undefined,
    onOpenStop: () => undefined,
  });
  showProjectParts([...drawn.values()].map((sites) => ({ mateIds: [], sites, review: undefined })));
}
