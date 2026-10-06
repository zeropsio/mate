import { useAtomValue } from "@effect/atom-react";

import { hqNavigationAtom } from "../state/zerops";
import { useAccountHq } from "./accountHq";
import { hqNavigationSettled } from "./hqRead.logic";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** The active organization's HQ list, apart from this tab's registered socket shells. */
export function useHqMatesRead(): {
  readonly organizationId: string | null;
  readonly settled: boolean;
} {
  const session = useZeropsSessionOptional();
  const organizationId =
    session?.status === "signed-in" ? (session.activeOrganization?.id ?? null) : null;
  const accountHq = useAccountHq(organizationId ?? undefined);
  const navigation = useAtomValue(hqNavigationAtom);
  return {
    organizationId,
    settled: hqNavigationSettled({ organizationId, accountHq, navigation }),
  };
}
