/**
 * How many usable environments the client holds, read outside React: the
 * route guards decide before anything renders, and the door counts these
 * once the catalog has loaded (see `awaitDoorEnvironmentCount`).
 */
import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { awaitDoorEnvironmentCount } from "./-door";

export function loadDoorEnvironmentCount(): Promise<number> {
  return awaitDoorEnvironmentCount(appAtomRegistry, {
    catalogAtom: environmentCatalog.catalogAtom,
    presentationsAtom: environmentPresentations.presentationsAtom,
  });
}
