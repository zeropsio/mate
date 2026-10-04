/**
 * Whether every Mate this tab will register is registered or will not be (unknown is not empty,
 * but it ends): the catalog is read, the Mates' listing will tell no more (`listingSettled`), and no
 * Mate it wants is still on its way to registering (`registrationOnItsWay`); only a
 * lease or an explicit Connect wants a registration (A9). What waits on "every
 * environment" (the usage limits, the home's "no projects") reads this.
 */
import { useAtomValue } from "@effect/atom-react";
import { registrationOnItsWay } from "@t3tools/client-runtime/zerops/environments";
import { listingSettled } from "@t3tools/client-runtime/zerops/projections";

import { environmentCatalog } from "../connection/catalog";
import { useEnvironmentMachines } from "./accountEnvironments";
import { useListingPatience } from "./useListingPatience";
import { useZeropsCandidates } from "./useZeropsCandidates";

export function useMatesSettled(): boolean {
  const catalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  const { listing, isLoading } = useZeropsCandidates();
  const patient = useListingPatience(listing);
  const machines = useEnvironmentMachines();
  const registering = [...machines.values()].some(registrationOnItsWay);
  return catalogReady && listingSettled(listing, { loading: isLoading, patient }) && !registering;
}
