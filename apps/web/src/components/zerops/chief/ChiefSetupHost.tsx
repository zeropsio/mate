/**
 * Mounted once, above every view: whose Chief the person has, as HQ answers it, and the runner
 * that sets one up, its steps running on wherever the person goes. The Chief page shows them.
 */
import { useChiefSetupRunner } from "~/zerops/chiefSetup";
import { useOwnChiefRead } from "~/zerops/ownChief";

export function ChiefSetupHost() {
  useOwnChiefRead();
  useChiefSetupRunner();
  return null;
}
