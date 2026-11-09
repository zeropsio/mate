/**
 * One application's places — production and each stage — as the left menu's chips read them
 * (`productionChip`, `stageStopChip`), from the same inputs the menu reads them from: the
 * platform's deployments and services, HQ's releases. Every surface that names a place (the
 * overview's card, the project page, a place's page, a Mate's panels) reads it from here, so they
 * say the same of one production.
 *
 * Pure: no React, no clock of its own.
 */
import {
  releaseFailureOf,
  stageMarks,
  stageStandings,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { deployActivatedAt, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { mainStageOf } from "../review/reviewReads";
import {
  buildingOf,
  drawnChip,
  productionChip,
  rollbacksOf,
  stageStopChip,
  stopServing,
  type ProductionChip,
  type ReleasesAnswer,
  type StopServing,
} from "../SidebarProductionChip.logic";
import {
  cardReady,
  placeLines,
  productionBuilding,
  type CardReady,
  type CardStage,
  type PlaceLine,
} from "../projects/projectCard.logic";
import type { ProjectsFlowGroup } from "../projects/ZeropsProjectsFlow";

/** What an application's places need of an environment: how its services stand, where they answer. */
export interface PlaceItem {
  readonly project: { readonly id: string; readonly status?: string | undefined };
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** Public-access evidence of an address publication in progress; absent while unread. */
  readonly addressPending?: boolean | undefined;
  /** Ports its public address would open that are not on yet; absent while its services are unread. */
  readonly routeOffers?: ReadonlyArray<unknown> | undefined;
  readonly services?:
    | {
        readonly hostnames: ReadonlyArray<string>;
        readonly deployedAt: string | undefined;
        readonly statuses: ReadonlyArray<{
          readonly hostname: string;
          readonly status: string;
          readonly runtime: boolean;
        }>;
      }
    | undefined;
}

/** The part of an application's row its places are read from. */
export type PlacesEntry<T extends PlaceItem> = Pick<ProjectsFlowGroup<T>, "flow" | "stops">;

const UNKNOWN: StopServing = { kind: "unknown" };
const NO_UNTOLD: ReadonlyArray<string> = [];

/**
 * Every place of an application as the menu's chips say it: production's chip, each stage's, the
 * services the platform marks failed by place, addresses being published, the release a roll back
 * goes back to, and when production took what it runs.
 */
export function applicationPlaceFacts<T extends PlaceItem>(input: {
  readonly entry: PlacesEntry<T>;
  /** The application's flow reads (`useProjectFlows`); `undefined` while unread. */
  readonly read: ZeropsProjectFlow | undefined;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
}) {
  const { entry, read, deployments } = input;
  const itemOf = (projectId: string | undefined) =>
    projectId === undefined ? undefined : entry.stops.get(projectId)?.item;
  const servingOf = (item: T | undefined): StopServing =>
    item === undefined
      ? UNKNOWN
      : stopServing({
          projectStatus: item.project.status,
          services: item.services?.statuses,
          routes: item.routes ?? [],
        });
  const downOf = (serving: StopServing) => (serving.kind === "down" ? serving.services : []);
  const releases: ReleasesAnswer =
    read !== undefined && read.releasesKnown
      ? {
          kind: "answered",
          failure: releaseFailureOf({
            releases: read.releases,
            environmentInputs: read.environmentInputs,
            stalled: read.release.stalled,
          }),
          rollbacks: rollbacksOf(read.releases),
        }
      : { kind: "waiting" };
  const deploymentsOf = (id: string) => {
    const row = read?.environments.find((environment) => environment.id === id);
    const projectId =
      row === undefined
        ? entry.stops.get(id)?.item?.project.id
        : row.target.kind === "zerops"
          ? row.target.projectId
          : undefined;
    return projectId === undefined ? undefined : deployments.get(projectId);
  };
  const { production } = entry.flow;
  const prodStop = "stop" in production ? production.stop : undefined;
  const prodItem = itemOf(prodStop?.projectId);
  const prodServing = servingOf(prodItem);
  const chip = drawnChip(
    productionChip({
      production,
      building: productionBuilding(
        production.kind,
        prodStop === undefined ? undefined : buildingOf(deploymentsOf(prodStop.projectId)),
      ),
      waiting: entry.flow.main.notLive,
      waitingAtLeast: entry.flow.main.notLiveAtLeast,
      changeCount: entry.flow.main.changeCount,
      untold: read?.release.untold ?? NO_UNTOLD,
      serving: prodServing,
      releases,
    }),
  );
  const stageChips = new Map<string, ProductionChip | undefined>();
  const down = new Map<string, ReadonlyArray<string>>();
  const addressPending = new Map<string, boolean>();
  if (prodStop !== undefined) down.set(prodStop.projectId, downOf(prodServing));
  for (const stop of entry.flow.stages) {
    const item = itemOf(stop.projectId);
    const serving = servingOf(item);
    down.set(stop.projectId, downOf(serving));
    const pending = item?.addressPending;
    if (pending !== undefined) addressPending.set(stop.projectId, pending);
    stageChips.set(stop.projectId, drawnChip(stageStopChip({ stop, serving, releases })));
  }
  const since =
    prodStop === undefined
      ? undefined
      : (deployActivatedAt(deploymentsOf(prodStop.projectId)) ?? prodItem?.services?.deployedAt);
  // The release on its way, where it is a roll back: production's line says what it goes back to.
  const rollsBackTo = chip?.rollsBackTo;
  return {
    read,
    releases,
    chip,
    stageChips,
    down,
    addressPending,
    rollsBackTo,
    since,
    prodItem,
    prodStop,
  };
}

/**
 * What the stage that follows `main` runs, as HQ's deploys say it, and whether it runs every change
 * a release would carry — `undefined` while either is unread.
 */
export function applicationStage(read: ZeropsProjectFlow | undefined):
  | {
      readonly stage: CardStage;
      readonly runsRelease: boolean | undefined;
    }
  | undefined {
  const environment = read === undefined ? undefined : mainStageOf(read);
  if (read === undefined || environment === undefined) return undefined;
  const standings = stageStandings(environment);
  const mainHeads = new Map(
    (read.repos ?? []).flatMap(({ name, mainHead }) =>
      mainHead === null ? [] : [[name, mainHead] as const],
    ),
  );
  const marks = stageMarks({ contents: read.release.contents, stage: standings, mainHeads });
  return {
    stage: {
      runs: [...standings.runs.values()].filter((sha) => sha !== undefined),
      deploying: [...standings.deploying.values()],
      mainHeads,
    },
    runsRelease:
      marks.size === 0 ? undefined : [...marks.values()].every((mark) => mark === "on-stage"),
  };
}

/**
 * An application's places as lines, production first — what a person runs for others — then each
 * stage; and the release waiting for production (`cardReady`) with whether the stage runs all of it.
 */
export function applicationPlaces<T extends PlaceItem>(input: {
  readonly entry: PlacesEntry<T>;
  readonly read: ZeropsProjectFlow | undefined;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  readonly nowMs: number;
}): {
  readonly places: ReadonlyArray<PlaceLine>;
  readonly ready: CardReady | undefined;
  readonly onStage: boolean | undefined;
} {
  const facts = applicationPlaceFacts(input);
  const lines = placeLines({
    flow: input.entry.flow,
    chip: facts.chip,
    stageChips: facts.stageChips,
    down: facts.down,
    addressPending: facts.addressPending,
    rollsBackTo: facts.rollsBackTo,
    since: facts.since,
    nowMs: input.nowMs,
  });
  return {
    places: [
      ...lines.filter((line) => line.kind === "production"),
      ...lines.filter((line) => line.kind === "stage"),
    ],
    ready: cardReady(input.entry.flow),
    onStage: applicationStage(input.read)?.runsRelease,
  };
}
