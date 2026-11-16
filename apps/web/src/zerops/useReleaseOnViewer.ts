/**
 * Whether a project's release, where HQ offers it to the person looking, waits on them
 * (`releaseWaitsOnViewer`): the project is theirs, or its limit on who merges and releases names
 * them, or nobody else can and they are an Owner or Admin. Being allowed to release is not being
 * asked to: an Owner is offered every project's release, and most are somebody else's move.
 *
 * The one reading for everything that counts or says "Waiting on you" — the menu's list and badge,
 * the overview's tab and cards — and for the menu's Release tag, which stays a door and goes quiet.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { releaseWaitsOnViewer, type MateWhose } from "@t3tools/client-runtime/zerops";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";

import { hqNavigationAtom, zeropsSessionAtom } from "../state/zerops";
import { useZeropsSessionOptional } from "./sessionContext";

interface ReleaseFacts {
  readonly [appId: string]: {
    readonly mates: ReadonlyArray<MateWhose>;
    readonly mergers: ReadonlyArray<string> | null;
    readonly manages: boolean;
  };
}

const NO_FACTS: ReleaseFacts = {};

/**
 * What the rule reads of each application, shared structurally: the same object until a Mate
 * changes hands, the limit changes, or the person's role does.
 */
const releaseFactsAtom = Atom.make((get): ReleaseFacts => {
  const view = get(hqNavigationAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  if (view.orgId !== organizationId || view.structure === null) return NO_FACTS;
  const people = get(shownHqProjectPeopleAtom);
  return Object.fromEntries(
    view.structure.apps.map((app) => [
      app.id,
      {
        mates: app.projects
          .filter((project) => project.mate != null)
          .map((project) => ({
            mine: people[project.projectId]?.mine,
            owned: people[project.projectId]?.owned,
          })),
        mergers: app.mergers?.people ?? null,
        // The organization's structure is an Owner's or Admin's (`structurePermission`).
        manages: hqOffer(app.can, "structure").kind === "allowed",
      },
    ]),
  );
}).pipe(
  Atom.withEquality((a, b) => shareEqual(a, b) === a),
  Atom.withLabel("zerops:release-on-viewer"),
);

/**
 * Whether an application's offered release waits on the person looking, by its id. One HQ's
 * navigation does not hold reads as today: its release is theirs.
 */
export function useReleaseOnViewer(): (appId: string) => boolean {
  const facts = useAtomValue(releaseFactsAtom);
  const userId = useZeropsSessionOptional()?.user?.id;
  return useCallback(
    (appId) => {
      const app = facts[appId];
      return app === undefined || releaseWaitsOnViewer({ ...app, userId });
    },
    [facts, userId],
  );
}
