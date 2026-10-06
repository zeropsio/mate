import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import { toneIdForKind } from "@t3tools/shared/threadStatus";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { hqMatesAtom } from "../state/zerops";
import { useMutedMates } from "../zerops/mutedMates";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import {
  observedEnvironments,
  watchMates,
  type MatesBaseline,
} from "./ThreadNotificationCoordinator.logic";
import { toastManager } from "./ui/toast";
import { threadStatusToneTextClass } from "./Sidebar.logic";
import { cn } from "~/lib/utils";

/**
 * Notifications for every Mate the person may observe, from HQ's overview of it (step A): no
 * socket to a Mate is needed for its chats to ring. The view HQ answers now is the baseline;
 * while it is not current — HQ's stream ended or broke — nothing rings, and the next view is a
 * baseline again, so nothing that happened meanwhile is replayed.
 */
export function ThreadNotificationCoordinator() {
  const view = useAtomValue(hqMatesAtom);
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  // A pending notification closes once its Mate leaves HQ's view — as last known, so a stream
  // that broke for a moment closes none.
  const known = view?.mates ?? null;
  useEffect(() => {
    const observed = observedEnvironments(known);
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (observed.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [known]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return (
    <MatesNotifications
      mates={view?.current === true ? view.mates : null}
      onNotification={onNotification}
    />
  );
}

function MatesNotifications({
  mates,
  onNotification,
}: {
  /** HQ's view of the Mates now; none while it is not HQ's answer now. */
  mates: HqMates | null;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  // A Mate is one environment, so muting it (the left menu's Mate menu) is
  // this environment ringing for nothing — while it is still watched, so an
  // unmute rings for what happens after and never for what it missed.
  const { muted } = useMutedMates();
  const previous = useRef<MatesBaseline | null>(null);

  useEffect(() => {
    const { next, rings } = watchMates(previous.current, mates, Date.now());
    previous.current = next;
    for (const ring of rings) {
      const { environmentId, threadId, kind, status } = ring;
      if (muted.includes(environmentId)) continue;
      // The glyph and its colour are the sidebar row's for the same status.
      const NotificationIcon =
        kind === "completion"
          ? CircleCheckIcon
          : status === "approval"
            ? ShieldQuestionIcon
            : status === "failed"
              ? CircleAlertIcon
              : MessageCircleQuestionIcon;
      const title =
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "failed"
              ? "Thread failed"
              : "Input needed";
      if (hasNotificationSound(mode)) {
        void playNotificationSound(kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        inAppNotificationsEnabled &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== threadId)
      ) {
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          title,
          description: maskSecrets(ring.title),
          data: {
            hideCopyButton: true,
            leadingIcon: (
              <NotificationIcon
                aria-hidden
                className={cn(
                  "size-4",
                  threadStatusToneTextClass(
                    kind === "completion" ? "success" : toneIdForKind(status),
                  ),
                )}
              />
            ),
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId },
              });
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification(title, {
          body: maskSecrets(ring.title),
          tag: `${environmentId}:${threadId}`,
          silent: true,
        });
        onNotification(environmentId, notification);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId },
          });
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    }
  }, [
    activeEnvironmentId,
    activeThreadId,
    inAppNotificationsEnabled,
    mates,
    mode,
    muted,
    navigate,
    onNotification,
  ]);

  return null;
}
