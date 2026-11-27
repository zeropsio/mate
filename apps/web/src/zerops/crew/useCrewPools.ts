/**
 * A Mate's dev pools, where a crew's builder can take a copy of its own, as its project's topology
 * names them; `undefined` until the topology reads. The Crew tab and a crew card read them here.
 */
import { isPoolServiceType } from "@t3tools/client-runtime/zerops/topology";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useProjectTopology } from "../useProjectTopology";

export function useCrewPools(environmentId: EnvironmentId): ReadonlyArray<string> | undefined {
  const services = useProjectTopology(environmentId).view?.services;
  return useMemo(
    () =>
      services
        ?.filter((service) => isPoolServiceType(service.type))
        .map((service) => service.hostname),
    [services],
  );
}
