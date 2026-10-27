/**
 * Whether HQ's update waits for the viewer: an owner or an admin of the organization in view, whose
 * HQ answers with an older Core than this app carries — from what is already read, as HQ's row in
 * Settings → Zerops offers it (`hqUpdateTrigger`).
 */
import { useAtomValue } from "@effect/atom-react";
import { hqZeropsProject } from "@t3tools/client-runtime/zerops/hq";
import { mayBearHq } from "@t3tools/shared/zeropsRoles";

import { hqUpdateTrigger } from "~/components/zerops/ZeropsHqUpdate.logic";
import { hqStandingAtom } from "~/state/zerops";
import { useCarriedCoreBuild, useAccountHq } from "~/zerops/accountHq";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

export function useHqUpdateWaiting(): boolean {
  const session = useZeropsSessionOptional();
  const standing = useAtomValue(hqStandingAtom);
  const carried = useCarriedCoreBuild();
  const accountHq = useAccountHq(session?.activeOrganization?.id);
  const signedIn = session !== null && session.status === "signed-in";
  const admin = signedIn && mayBearHq(session.activeOrganization ?? undefined);
  return (
    hqUpdateTrigger({
      admin,
      ownProject: hqZeropsProject(accountHq.hq) !== undefined,
      standing,
      carried,
    }) === "Update available"
  );
}
