import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { openMateScreen } from "./open-mate";
import { useZeropsData } from "./ZeropsAccountEnvironmentProvider";

/** The screen of this environment's Mate is open while the calling screen is mounted (A9). */
export function useOpenMateScreen(environmentId: EnvironmentId | null): void {
  const { environments } = useZeropsData();
  useEffect(
    () => (environmentId === null ? undefined : openMateScreen(environments, environmentId)),
    [environments, environmentId],
  );
}
