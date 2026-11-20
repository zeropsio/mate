import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { mateHealthAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { useMateRecoveryAction } from "./zerops/useMateRecoveryAction";
import { useReviveFailedMate } from "../zerops/mateRestart";
import { useTryMateAgain } from "../zerops/accountEnvironments";
import { zeropsMateAt, type ZeropsMateDirectory } from "../zerops/mateIdentities";
import type { WebMateVoice } from "../zerops/mateNoticeVoice";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { mateHealthBannerItem } from "./chat/MateHealthBanner";
import {
  environmentConnectionBannerItem,
  mateVoiceBannerItem,
} from "./chat/EnvironmentConnectionBanner";

export type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly connection: EnvironmentConnectionPresentation;
};

/** The Mate's link and health banners over the composer (`systemComposerBannerItems` in `ConversationView`). */
export function useSystemComposerBannerItems({
  zeropsMates,
  environmentId,
  mateLinkVoice,
  activeEnvironmentUnavailableState,
  reconnectWarningGraceElapsed,
  handleReconnectActiveEnvironment,
}: {
  zeropsMates: ZeropsMateDirectory;
  environmentId: EnvironmentId;
  mateLinkVoice: WebMateVoice;
  activeEnvironmentUnavailableState: EnvironmentUnavailableState | null;
  reconnectWarningGraceElapsed: boolean;
  handleReconnectActiveEnvironment: (environmentId: EnvironmentId) => Promise<void>;
}) {
  const reviveFailedMate = useReviveFailedMate();
  const recoveryMate = zeropsMateAt(zeropsMates, environmentId);
  const mateRecoveryAction = useMateRecoveryAction(
    recoveryMate.kind === "mate" ? (recoveryMate.mate.projectId ?? null) : null,
  );
  const tryMateAgain = useTryMateAgain();
  const healthRead = useAtomValue(
    mateHealthAtom(recoveryMate.kind === "mate" ? (recoveryMate.mate.projectId ?? "") : ""),
  );
  const systemComposerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner = environmentReconnecting && !reconnectWarningGraceElapsed;
    // A Mate's link speaks with one voice, the route's (`mateVoice`): its banner, not the
    // connection's.
    const routeMateAt = zeropsMateAt(zeropsMates, environmentId);
    if (routeMateAt.kind === "mate") {
      const banner = mateVoiceBannerItem({
        environmentId,
        voice: mateLinkVoice,
        onContainerAction: mateRecoveryAction.act,
        busy: mateRecoveryAction.busy,
        recoveryFeedback: mateRecoveryAction.feedback,
        projectUrl: routeMateAt.mate.projectUrl,
        // A container that failed is stopped and started; any other Mate is asked again, its
        // exchange as well as its link.
        onRetry: () => {
          if (!reviveFailedMate(routeMateAt.mate.serviceId)) tryMateAgain(environmentId);
        },
        projects: <Link to="/zerops" />,
      });
      if (banner !== null) items.push(banner);
      const healthBanner = mateHealthBannerItem({
        name: routeMateAt.mate.name,
        read: healthRead,
        projectUrl: routeMateAt.mate.projectUrl,
      });
      if (healthBanner !== null) items.push(healthBanner);
      return items;
    }
    if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      const { environmentId } = activeEnvironmentUnavailableState;
      const mateAt = zeropsMateAt(zeropsMates, environmentId);
      const banner = environmentConnectionBannerItem({
        environmentId,
        connection: unavailableConnection,
        mateName: mateAt.kind === "mate" ? mateAt.mate.name : null,
        onRetry: () => void handleReconnectActiveEnvironment(environmentId),
      });
      if (banner !== null) items.push(banner);
    }
    return items;
  }, [
    activeEnvironmentUnavailableState,
    environmentId,
    mateLinkVoice,
    healthRead,
    mateRecoveryAction.act,
    mateRecoveryAction.busy,
    mateRecoveryAction.feedback,
    reconnectWarningGraceElapsed,
    reviveFailedMate,
    tryMateAgain,
    handleReconnectActiveEnvironment,
    zeropsMates,
  ]);
  return systemComposerBannerItems;
}
