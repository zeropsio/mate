/**
 * A stage or a production whose creation lost its last writes — its attach to its application, its
 * deploy key — or whose key HQ does not hold, or holds broken (main E07): the ones the account
 * holds and its application does not know in full, and the way to finish them when the person asks
 * (`useFinishGroupEnvironment`). The projects page and an application's own page read this one
 * answer.
 *
 * Only an application whose environments HQ has said says what it holds: one still unsaid would
 * read as holding nothing, and every environment in it as half-made.
 */
import { useAccountOperations } from "./accountOperations";
import { halfMadeGroupEnvironments } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { hqEnvironmentsAtom } from "~/state/zerops";

import { useAccountHq } from "./accountHq";
import { useKeepDeployKeyOffer } from "./useChangeOffers";
import { useFinishGroupEnvironment } from "./useFinishGroupEnvironment";
import { usePressesElsewhere } from "./usePressesElsewhere";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function useHalfMadeEnvironments(candidates: ReadonlyArray<ZeropsCandidate>) {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  const accountHq = useAccountHq(activeOrganization?.id);
  const hq = accountHq.hq.kind === "official" ? accountHq.hq : undefined;
  const registryState = useZeropsRegistry();
  const heldEnvironments = useAtomValue(hqEnvironmentsAtom);
  const mayKeepKey = useKeepDeployKeyOffer();
  // A press still at a project — this browser's or another's, as HQ holds it — is its own to finish.
  const pressOf = usePressesElsewhere(candidates);
  const halfMade = useMemo(
    () =>
      heldEnvironments === null
        ? []
        : halfMadeGroupEnvironments({
            projects: candidates.map((candidate) => candidate.project),
            registry: registryState.registry,
            environments: heldEnvironments,
            // A key is minted only by somebody HQ offers keeping it (`keep_deploy_token`).
            mayKey: (projectId) => mayKeepKey(projectId) === true,
            pressing: (projectId) => pressOf(projectId) === "pressing",
          }),
    [candidates, heldEnvironments, mayKeepKey, pressOf, registryState.registry],
  );
  const finishing = useFinishGroupEnvironment({
    operations,
    clientId: activeOrganization?.id,
    hq,
  });
  return { halfMade, finishing };
}
