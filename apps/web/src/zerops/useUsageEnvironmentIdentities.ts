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

import {
  hqPeopleAtom,
  hqNavigationAtom,
  hqPlacementStatusAtom,
  zeropsEnvironmentsAtom,
} from "../state/zerops";
import { registeredZeropsOrigins } from "./environmentOrigins";
import {
  usageEnvironmentIdentities,
  usageEnvironmentOwner,
  type UsageEnvironmentOwner,
  usageBaselineStatus,
  usageOwnersStatus,
  type UsageEnvironmentIdentities,
  type UsageOwnersStatus,
  type UsagePeopleStatus,
} from "./usageEnvironmentIdentities";
import { useDiscoveryStatus } from "./useDiscoveryStatus";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NONE: UsageEnvironmentIdentities = new Map();

export function useUsageEnvironmentIdentities(): {
  readonly identities: UsageEnvironmentIdentities;
  readonly owners: UsageOwnersStatus;
  /** The environments are listed whole: no Mate is still to be registered (`useDiscoveryStatus`). */
  readonly listed: boolean;
  readonly baseline: UsageOwnersStatus;
  readonly projects: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, UsageEnvironmentOwner>;
  readonly refresh: () => void;
} {
  const session = useZeropsSession();
  const signedIn = session.status === "signed-in";
  const { listing, refresh } = useZeropsCandidates();
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const people = useAtomValue(hqPeopleAtom);
  const navigation = useAtomValue(hqNavigationAtom);
  const placementStatus = useAtomValue(hqPlacementStatusAtom);
  const currentOrgId = session.activeOrganization?.id ?? null;
  const sameOrg = currentOrgId !== null && navigation.orgId === currentOrgId;
  const hqAnswered = navigation.live;
  const peopleStatus: UsagePeopleStatus =
    !signedIn || session.activeOrganization === null
      ? "idle"
      : people !== null
        ? "ready"
        : hqAnswered
          ? "failed"
          : "loading";
  const projectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session.user?.id ?? null;
  const identities = useMemo(
    () =>
      signedIn && sameOrg
        ? usageEnvironmentIdentities({
            candidates: heldCandidates(listing).rows,
            registeredOrigins: registeredZeropsOrigins(environments),
            owners: projectPeople,
            viewerUserId,
          })
        : NONE,
    [signedIn, sameOrg, listing, environments, projectPeople, viewerUserId],
  );
  const owners = usageOwnersStatus({
    session: session.status,
    organization: session.organizationStatus,
    people: peopleStatus,
    listing: listing.state,
  });
  const listed = useDiscoveryStatus() === "complete";
  const baseline =
    session.status === "loading"
      ? "resolving"
      : usageBaselineStatus({
          orgId: currentOrgId,
          navigationOrgId: navigation.orgId,
          navigation,
          placement: placementStatus,
          listing: listing.state,
        });
  const projects = useMemo(() => {
    const projects = new Map<string, string>();
    if (sameOrg && navigation.structure !== null)
      for (const app of navigation.structure.apps) projects.set(app.id, app.name);
    return projects;
  }, [sameOrg, navigation.structure]);
  const knownPeople = useMemo(() => {
    const values = new Map<string, UsageEnvironmentOwner>();
    if (signedIn && sameOrg)
      for (const person of Object.values(projectPeople)) {
        const owner = usageEnvironmentOwner(person.owner, viewerUserId);
        if (owner !== null) values.set(owner.id, owner);
      }
    return values;
  }, [signedIn, sameOrg, projectPeople, viewerUserId]);
  return { identities, owners, listed, baseline, projects, people: knownPeople, refresh };
}
