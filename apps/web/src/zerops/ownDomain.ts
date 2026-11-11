/**
 * Whether a place has a domain of its own, for the doors that offer one: the globe's "Add your
 * domain" and the release review's "Put it on your domain". Read from the place's addresses while
 * the surface showing the door is drawn; never said before its routings are read.
 */
import {
  addresses,
  lacksOwnDomain,
  PROJECT_ROUTINGS_LISTING,
  type PlaceAddresses,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";

import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";

const NOT_READ = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
  nothingDeployed: false,
});

/** Whether the project is read and has no domain of its own; `false` outside an account. */
export function useLacksOwnDomain(projectId: string | undefined): boolean {
  const orgId = useAccountOrgId();
  const place = useProjection(
    addresses,
    orgId === null || projectId === undefined ? null : { orgId, projectId },
    NOT_READ,
  );
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    place.readsProject && projectId !== undefined ? projectId : null,
  );
  return lacksOwnDomain(place);
}
