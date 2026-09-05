/**
 * How many usable environments the client holds, read outside React: the
 * route guards decide before anything renders, and the door counts these.
 */
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { countDoorEnvironments } from "./-door";

export function readDoorEnvironmentCount(): number {
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  return countDoorEnvironments([...presentations.values()]);
}
