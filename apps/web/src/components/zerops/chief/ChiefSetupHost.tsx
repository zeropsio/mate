/**
 * Mounted once, above every view: whose Chief the person has, as HQ answers it, and the dialog
 * that sets one up, its steps running on while it is closed.
 */
import { useOfficialHq } from "~/zerops/accountHq";
import {
  closeChiefSetup,
  openChiefSetup,
  useChiefSetup,
  useChiefSetupRunner,
} from "~/zerops/chiefSetup";
import { useOwnChiefRead } from "~/zerops/ownChief";

import { ChiefSetupDialog } from "./ChiefSetupDialog";

export function ChiefSetupHost() {
  useOwnChiefRead();
  const { open, setup } = useChiefSetup();
  const { start, again } = useChiefSetupRunner();
  const official = useOfficialHq();
  return (
    <ChiefSetupDialog
      blocked={official === null ? "Reaching your organization's HQ…" : undefined}
      onAgain={again}
      onOpenChange={(next) => (next ? openChiefSetup() : closeChiefSetup())}
      onSetUp={start}
      open={open}
      setup={setup}
    />
  );
}
