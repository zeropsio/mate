import { useAtomValue } from "@effect/atom-react";
import { hqNavigationAnswered } from "@t3tools/client-runtime/data";

import { hqNavigationAtom } from "../state/zerops";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * The active organization's HQ list, apart from this tab's registered socket shells: settled once
 * HQ's navigation of it answered (`hqNavigationAnswered`), never while it only reconnects.
 */
export function useHqMatesRead(): {
  readonly organizationId: string | null;
  readonly settled: boolean;
} {
  const session = useZeropsSessionOptional();
  const organizationId =
    session?.status === "signed-in" ? (session.activeOrganization?.id ?? null) : null;
  const navigation = useAtomValue(hqNavigationAtom);
  return {
    organizationId,
    settled:
      organizationId === null ||
      (navigation.orgId === organizationId && hqNavigationAnswered(navigation)),
  };
}
