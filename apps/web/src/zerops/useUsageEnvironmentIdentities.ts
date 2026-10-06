/**
 * Who each usage environment belongs to (`usageEnvironmentIdentities.ts`),
 * off the same candidate listing, registered environments and HQ's owners the
 * left menu reads. Empty while nobody is
 * signed in to Zerops; `owners` says whether that emptiness is final yet
 * (`usageOwnersStatus`).
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import { hqPeopleAtom, hqNavigationAtom, zeropsEnvironmentsAtom } from "../state/zerops";
import { registeredZeropsOrigins } from "./environmentOrigins";
import {
  usageEnvironmentIdentities,
  usageOwnersStatus,
  type UsageEnvironmentIdentities,
  type UsageOwnersStatus,
  type UsagePeopleStatus,
} from "./usageEnvironmentIdentities";
import { useMatesSettled } from "./useMatesSettled";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NONE: UsageEnvironmentIdentities = new Map();

export function useUsageEnvironmentIdentities(): {
  readonly identities: UsageEnvironmentIdentities;
  readonly owners: UsageOwnersStatus;
  /** The environments are listed whole: no Mate is still to be registered (`useMatesSettled`). */
  readonly listed: boolean;
} {
  const session = useZeropsSession();
  const signedIn = session.status === "signed-in";
  const { listing } = useZeropsCandidates();
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const people = useAtomValue(hqPeopleAtom);
  const hqAnswered = useAtomValue(hqNavigationAtom).live;
  const peopleStatus: UsagePeopleStatus =
    !signedIn || session.activeOrganization === null
      ? "idle"
      : people !== null
        ? "ready"
        : hqAnswered
          ? "failed"
          : "loading";
  const projectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const mateOwners = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(projectPeople).map(([projectId, entry]) => [projectId, entry.owner]),
      ),
    [projectPeople],
  );
  const viewerUserId = session.user?.id ?? null;
  const identities = useMemo(
    () =>
      signedIn
        ? usageEnvironmentIdentities({
            candidates: heldCandidates(listing).rows,
            registeredOrigins: registeredZeropsOrigins(environments),
            owners: mateOwners,
            viewerUserId,
          })
        : NONE,
    [signedIn, listing, environments, mateOwners, viewerUserId],
  );
  const owners = usageOwnersStatus({
    session: session.status,
    organization: session.organizationStatus,
    people: peopleStatus,
    listing: listing.state,
  });
  const listed = useMatesSettled();
  return { identities, owners, listed };
}
