import { useAtomValue } from "@effect/atom-react";

import { hqMatesAtom, hqStructureAtom } from "../state/zerops";
import { useAccountHq } from "./accountHq";
import { hqMatesSettled } from "./hqRead.logic";
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
  const mates = useAtomValue(hqMatesAtom);
  const structure = useAtomValue(hqStructureAtom);
  return {
    organizationId,
    settled: hqMatesSettled({ organizationId, accountHq, mates, structure }),
  };
}
