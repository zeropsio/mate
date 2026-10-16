/**
 * A Mate's code checkouts by hostname, as its project's topology says them
 * (`gitCheckoutHostnames`); `undefined` while unread, off Zerops, or not asked (`environmentId`
 * null: a hidden terminal reads nothing).
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { gitCheckoutHostnames } from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import { useProjectTopology } from "./useProjectTopology";

export function useMateCheckouts(
  environmentId: EnvironmentId | null,
): ReadonlyArray<string> | undefined {
  const { view } = useProjectTopology(environmentId);
  return useMemo(
    () => (view === undefined ? undefined : gitCheckoutHostnames(view.services)),
    [view],
  );
}
