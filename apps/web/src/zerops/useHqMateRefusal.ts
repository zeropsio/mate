import { useAtomValue } from "@effect/atom-react";
import { hqMateRefusalAtom } from "@t3tools/client-runtime/data";
import { useEffect } from "react";

import { useAccountDataOptional } from "./ZeropsAccountData";

/** A direct address holds HQ's own admission answer without adding a personal list entry. */
export function useHqMateRefusal(projectId: string) {
  const account = useAccountDataOptional();
  const demandDetail = account?.demandDetail;
  const orgId = account?.orgId;
  useEffect(() => {
    if (demandDetail === undefined || orgId == null) return;
    return demandDetail({ family: "hqMate", ownerId: projectId });
  }, [demandDetail, orgId, projectId]);
  return useAtomValue(hqMateRefusalAtom(projectId));
}
