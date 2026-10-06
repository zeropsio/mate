/**
 * Who each usage environment belongs to (`usageEnvironmentIdentities.ts`),
 * off the same candidate listing, registered environments, HQ's people and
 * member list (for pictures) the left menu reads. Empty while nobody is
 * signed in to Zerops; `owners` says whether that emptiness is final yet
 * (`usageOwnersStatus`).
 */
import { useAtomValue } from "@effect/atom-react";
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
import { useZeropsOrganizationMembers } from "./useZeropsMateOwners";
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
  const members = useZeropsOrganizationMembers({
    clientId: session.activeOrganization?.id,
    enabled: signedIn && people !== null && Object.keys(people).length > 0,
  });
  const viewerUserId = session.user?.id ?? null;
  const identities = useMemo(
    () =>
      signedIn
        ? usageEnvironmentIdentities({
            candidates: heldCandidates(listing).rows,
            registeredOrigins: registeredZeropsOrigins(environments),
            people,
            members,
            viewerUserId,
          })
        : NONE,
    [signedIn, listing, environments, people, members, viewerUserId],
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
