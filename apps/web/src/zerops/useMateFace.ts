/**
 * One Mate's face where no menu row hands its facts over — the top bar of its chat: read from the
 * same records the row reads (its activity, its link to HQ, whose it is, its change's review, its
 * life), so the two wear the same face at the same moment (`mateFace`).
 */
import { readZeropsMembership } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { mateReviewWaits, type ZeropsAgentActivity } from "./agentActivity";
import { mateDeleting, useDeletingMates } from "./deletingMates";
import { mateActivityAtom } from "./mateActivityAtoms";
import type { MateFaceFacts } from "./mateFace.logic";
import { mateIdentityPose, type ZeropsMateIdentity } from "./mateIdentities";
import { useAppsChanges } from "./projectFlows";
import { useZeropsInventory } from "./inventoryContext";
import { useMateFaceWatch } from "./useMateMoments";
import { useMateLinkedInHq } from "./useMenuMateReadings";
import { useNowMs } from "./useNowMs";
import { useHqProjectPerson } from "./useZeropsMateOwners";

const NO_ACTIVITY = Atom.make<ZeropsAgentActivity | undefined>(undefined);

export function useMateFaceFacts(
  environmentId: EnvironmentId,
  mate: Pick<ZeropsMateIdentity, "projectId" | "connected" | "running" | "arrivingUntil"> | null,
): MateFaceFacts {
  const projectId = mate?.projectId;
  // The record its row reads (`mateActivityAtom`): what it does across its chats, HQ's word or
  // its socket's — never the chat on screen's alone.
  const activity = useAtomValue(
    projectId === undefined ? NO_ACTIVITY : mateActivityAtom(projectId),
  );
  const linked = useMateLinkedInHq(projectId ?? "");
  const mine = useHqProjectPerson(projectId ?? "")?.waitsOnViewer === true;
  const project = useZeropsInventory().projects.find((entry) => entry.id === projectId);
  const groupId = readZeropsMembership(project).groupId;
  const { changes } = useAppsChanges(
    useMemo(() => (groupId === undefined ? [] : [groupId]), [groupId]),
  );
  const deletingIds = useDeletingMates();
  const deleting = project !== undefined && mateDeleting(project, deletingIds);
  const nowMs = useNowMs();
  const connected = mate?.connected ?? false;
  const { restarting, watched } = useMateFaceWatch({
    environmentId,
    projectId,
    arriving: mate?.arrivingUntil !== undefined,
    connected,
  });
  return {
    // Up as its row reads it (`mateAwake`): its container runs, or HQ holds its link open.
    connected: connected || mate?.running === true || linked,
    activity,
    reviewWaits:
      projectId !== undefined &&
      mateReviewWaits(groupId === undefined ? undefined : changes.get(groupId), projectId),
    mine,
    pose: {
      ...(mate === null ? {} : mateIdentityPose(mate, nowMs)),
      life: deleting ? "deleting" : "up",
    },
    restarting,
    watched,
  };
}
