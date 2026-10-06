import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { matesAttention, type MateAttentionRead } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import { toneIdForKind } from "@t3tools/shared/threadStatus";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { hqMatesAtom } from "../state/zerops";
import { useMutedMates } from "../zerops/mutedMates";
import { useAccountOrgId, useProjection } from "../zerops/ZeropsAccountData";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import {
  attentionWatch,
  observedEnvironments,
  overviewWatch,
  watchMates,
  type MatesBaseline,
  type WatchedMate,
} from "./ThreadNotificationCoordinator.logic";
import { toastManager } from "./ui/toast";
import { threadStatusToneTextClass } from "./Sidebar.logic";
import { cn } from "~/lib/utils";

const NO_ATTENTION_READ: Readonly<Record<string, MateAttentionRead>> = {};
const NO_ATTENTION = Atom.make(NO_ATTENTION_READ);

/**
 * Notifications for every Mate the person may observe, off its attention (`matesAttention`), or for
 * a Mate from before it, off HQ's overview of it: no socket to a Mate is needed for its chats to
 * ring. What is known of a Mate when its word comes to be of now is its baseline; while its word is
 * not of now — its link or HQ's broke — nothing of it rings, and the next look is a baseline again,
 * so nothing that happened meanwhile is replayed. Its count is the dock's badge.
 */
export function ThreadNotificationCoordinator() {
  const view = useAtomValue(hqMatesAtom);
  const orgId = useAccountOrgId();
  const projectIds = useMemo(
    () => (view === null ? [] : [...view.mates.keys()].toSorted()),
    [view],
  );
  const attention = useProjection(
    matesAttention,
    orgId === null ? null : { orgId, projectIds },
    NO_ATTENTION,
  );
  const told = view?.mates ?? null;
  const current = view?.current === true;
  const watched = useMemo(() => {
    const mates = new Map<string, WatchedMate>();
    for (const projectId of projectIds) {
      const overview = told?.get(projectId);
      const read = attention[projectId];
      const titled = (threadId: string) =>
        overview?.threads?.list.find((digest) => digest.id === threadId)?.title ?? "";
      const look =
        read !== undefined && read.attention !== null
          ? read.live
            ? attentionWatch(read.attention, titled)
            : undefined
          : current && overview !== undefined
            ? overviewWatch(overview)
            : undefined;
      if (look !== undefined) mates.set(projectId, look);
    }
    return mates;
  }, [attention, current, projectIds, told]);
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

  // A pending notification closes once its Mate leaves what is known — as last known, so a
  // stream that broke for a moment closes none.
  const known = told;
  const said = useMemo(
    () =>
      Object.values(attention).flatMap((read) => (read.attention === null ? [] : [read.attention])),
    [attention],
  );
  useEffect(() => {
    const observed = observedEnvironments(known, said);
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (observed.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [known, said]);

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

  return <MatesNotifications mates={watched} onNotification={onNotification} />;
}

function MatesNotifications({
  mates,
  onNotification,
}: {
  /** Each Mate whose word is of now, as the watch reads it. */
  mates: ReadonlyMap<string, WatchedMate>;
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
