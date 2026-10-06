/**
 * A stage or a production whose creation lost its last writes — its attach to its application, its
 * deploy key — or whose key HQ does not hold, or holds broken (main E07): the ones the account
 * holds and its application does not know in full, and the way to finish them when the person asks
 * (`useFinishGroupEnvironment`), each with whether HQ offers this person finishing it (`can.finish`
 * of its project). The projects page and an application's own page read this one answer.
 *
 * Only an application whose environments HQ has said says what it holds: one still unsaid would
 * read as holding nothing, and every environment in it as half-made.
 */
import { halfMadeGroupEnvironments } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { hqDown, hqEnvironmentsAtom, hqNavigationAtom } from "~/state/zerops";

import { useAccountHq } from "./accountHq";
import { finishOffered } from "./addEnvironment.logic";
import { useKeepDeployKeyOffer } from "./useChangeOffers";
import { useFinishGroupEnvironment } from "./useFinishGroupEnvironment";
import { usePressesElsewhere } from "./usePressesElsewhere";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function useHalfMadeEnvironments(candidates: ReadonlyArray<ZeropsCandidate>) {
  const { activeOrganization, client } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const hq = accountHq.hq.kind === "official" ? accountHq.hq : undefined;
  const registryState = useZeropsRegistry();
  const heldEnvironments = useAtomValue(hqEnvironmentsAtom);
  const mayKeepKey = useKeepDeployKeyOffer();
  // A press still at a project — this browser's or another's, as HQ holds it — is its own to finish.
  const pressOf = usePressesElsewhere(candidates);
  const navigation = useAtomValue(hqNavigationAtom);
  const halfMade = useMemo(() => {
    if (heldEnvironments === null) return [];
    const { structure } = navigation;
    // While HQ has said nothing of the structure, it offers finishing nothing.
    const canOf = (projectId: string) =>
      structure === null
        ? undefined
        : structure.apps
            .flatMap((app) => app.projects)
            .find((project) => project.projectId === projectId)?.can;
    const hqAnswers = { current: navigation.live, unavailableSince: hqDown(navigation) ? 0 : null };
    return halfMadeGroupEnvironments({
      projects: candidates.map((candidate) => candidate.project),
      registry: registryState.registry,
      environments: heldEnvironments,
      // A key is minted only by somebody HQ offers keeping it (`keep_deploy_token`).
      mayKey: (projectId) => mayKeepKey(projectId) === true,
      pressing: (projectId) => pressOf(projectId) === "pressing",
    }).map((entry) => ({
      ...entry,
      finish: finishOffered(canOf(entry.projectId), hqAnswers),
    }));
  }, [candidates, heldEnvironments, mayKeepKey, navigation, pressOf, registryState.registry]);
  const finishing = useFinishGroupEnvironment({ client, clientId: activeOrganization?.id, hq });
  return { halfMade, finishing };
}
