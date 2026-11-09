/**
 * One application's places and its next release, read through the same data-layer hooks the
 * overview reads every application with, for one: the Mates' listing, the inventory's groups, the
 * application's flow, the platform's deployments — joined into its row (`useProjectsPageRows`) and
 * said by `applicationPlaces`, the overview card's own derivation.
 */
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import { useNowMs } from "~/zerops/useNowMs";
import { useProjectOrderOptions } from "~/zerops/projectOrderPreference";
import {
  useCompactProjectFlows,
  useStopDeploymentsShown,
  type ZeropsProjectFlow,
} from "~/zerops/projectFlows";
import { useProjectsInventory } from "~/zerops/projectsInventory";
import { useProjectsPageRows } from "~/zerops/projectsPageRows";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import type { PlaceLine } from "../projects/projectCard.logic";
import { useReleaseOffer } from "../ZeropsReleaseVerb";
import { applicationPlaces } from "./applicationPlaces.logic";
import type { NextReleaseInput } from "./NextRelease";
import { nextReleaseView } from "./NextRelease.logic";

const NO_BIRTHS: ReadonlyArray<ZeropsPlacedBirth> = [];
const NO_LINES: ReadonlyMap<string, string | undefined> = new Map();
const NO_PLACES: ReadonlyArray<PlaceLine> = [];

export interface ApplicationPlaces {
  /** The application's name; `undefined` while unread (a crumb waits for it, never its id). */
  readonly groupName: string | undefined;
  /** Production first, then each stage: each a `PlaceLine`'s `line`. Empty while unread. */
  readonly places: ReadonlyArray<PlaceLine>;
  /** `NextRelease`'s props; `null` while nothing waits for production (or it is unread). */
  readonly next: NextReleaseInput | null;
  /** The application's flow reads, for what else a page says of it; `undefined` while unread. */
  readonly flow: ZeropsProjectFlow | undefined;
}

/** `useApplicationPlaces(groupId)` → `{ groupName, places, next, flow }`; see `ApplicationPlaces`. */
export function useApplicationPlaces(groupId: string): ApplicationPlaces {
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const inventory = useProjectsInventory(candidates, useProjectOrderOptions(), NO_BIRTHS);
  const groups = useMemo(
    () => inventory.groups.filter(({ group }) => group.groupId === groupId),
    [inventory.groups, groupId],
  );
  const flows = useCompactProjectFlows(useMemo(() => [groupId], [groupId]));
  const deployments = useStopDeploymentsShown();
  const rows = useProjectsPageRows({ groups, flows, deployments, lines: NO_LINES });
  const entry = rows[0];
  const read = flows.flows.get(groupId);
  const release = useReleaseOffer(groupId, read);
  const nowMs = useNowMs();
  const said = useMemo(
    () =>
      entry === undefined ? undefined : applicationPlaces({ entry, read, deployments, nowMs }),
    [entry, read, deployments, nowMs],
  );
  const next: NextReleaseInput | null =
    said === undefined ||
    nextReleaseView({ release, ready: said.ready, onStage: said.onStage }).kind === "none"
      ? null
      : { release, ready: said.ready, onStage: said.onStage };
  return {
    groupName: entry?.group.name,
    places: said?.places ?? NO_PLACES,
    next,
    flow: read,
  };
}
