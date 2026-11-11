/**
 * Who lives in a panel's environment, as the lists draw it: the name, the colour, today's face —
 * and its identity, for what else a panel asks of it. Nothing until the Mate list names one there,
 * so a panel never wears a guessed face.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { activityOfNow, mateFaceFor } from "../../zerops/agentActivity";
import { mateIdentityPose, zeropsMateAt } from "../../zerops/mateIdentities";
import { useNowMs } from "../../zerops/useNowMs";
import { useMatesActivity } from "../../zerops/useZeropsAgentActivity";
import { useZeropsMateDirectory } from "../../zerops/useZeropsMates";
import type { ZeropsMateOnMap } from "./ZeropsServiceMap";

export function useMateOnPanel(environmentId: EnvironmentId | undefined) {
  const mates = useZeropsMateDirectory();
  const activity = useMatesActivity();
  const nowMs = useNowMs();
  const whoLivesHere = environmentId === undefined ? null : zeropsMateAt(mates, environmentId);
  const identity = whoLivesHere?.kind === "mate" ? whoLivesHere.mate : undefined;
  // What it does now, where its attention is a word of now.
  const live =
    environmentId === undefined ? undefined : activityOfNow(activity.ofEnvironment(environmentId));
  const mate: ZeropsMateOnMap | undefined =
    identity === undefined
      ? undefined
      : {
          name: identity.name,
          tint: identity.tint,
          shape: identity.shape,
          // Asleep until its socket is up or HQ's live word says what it does, as the
          // lists draw it: a Mate is known from its project's tags and its container's
          // origin before there is anything to resolve — see `ChatHeader`.
          face: mateFaceFor(
            identity.connected || live !== undefined,
            live,
            mateIdentityPose(identity, nowMs),
          ),
        };
  return { identity, mate };
}
