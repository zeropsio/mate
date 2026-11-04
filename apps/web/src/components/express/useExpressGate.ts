/** The signed-in person's Adobe Express Labs switch, read against this build's Adobe key. */
import { useClientSettings } from "~/hooks/useSettings";
import { type ExpressGate, expressGate } from "./expressGate.logic";
import { expressClientId } from "./expressSdk";

export function useExpressGate(): ExpressGate {
  const switchOn = useClientSettings((settings) => settings.adobeExpressPanel);
  return expressGate(switchOn, expressClientId);
}
