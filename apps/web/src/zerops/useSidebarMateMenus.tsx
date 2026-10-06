/**
 * What a Mate's own menu in the left menu does, wired to the session.
 *
 * The verbs the projects screen offers too — *Restart* or *Start*, *Finish
 * setup*, *Hand over…*, *Move to project…*, *Delete {name}…* — are
 * `useMateActions`', one definition with its dialogs; *Rename* is its write
 * too, done where the name stands instead of in a dialog, and *Change face…*
 * its dialog, placed beside *Rename*. The rest is this viewer's own: a mute
 * this browser keeps (`mutedMates.ts`), read or unread (the visit marks the
 * thread rows use), a link to the conversation, and stopping the run it is on
 * — which the server leaves open to every member, a colleague having to be
 * able to stop an agent they may not start.
 *
 * A Mate this page holds no socket to is acted on by HQ's word of it (`mateMenuTarget`): its
 * environment and its main chat's last finished turn. Stopping a run holds the Mate connected
 * until it answers (`useMateCommand`).
 *
 * The group registry is read only once somebody opens a Mate's menu: it is
 * what *Finish setup* needs to know a Mate unregistered, and the menu is on every screen.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { projectNameInApp, readZeropsMembership } from "@t3tools/client-runtime/zerops";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import type { ZeropsMenuEntry } from "~/components/zerops/ZeropsProjectMenu";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { threadEnvironment } from "~/state/threads";
import { hqMatesAtom } from "~/state/zerops";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";

import { useMateCommand } from "./accountEnvironments";
import type { ZeropsAgentActivity } from "./agentActivity";
import { useMateActions } from "./useMateActions";
import { useDrawnProjectAccess } from "./useVisibleProjectAccess";
import { useMutedMates } from "./mutedMates";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsContainers } from "./zeropsContainers";

/** The shared verbs this menu carries, relabelled for a Mate's own menu. */
const SHARED_VERBS: Readonly<Record<string, string | null>> = {
  start: null,
  restart: null,
  "finish-setup": null,
  assign: "Hand over…",
  move: "Move to project…",
  delete: null,
};

/** `useMateActions`' entries this menu offers, in its words; the rest are the projects screen's. */
export function sidebarMateVerbs(
  entries: ReadonlyArray<ZeropsMenuEntry>,
): ReadonlyArray<ZeropsMenuEntry> {
  return entries.flatMap((entry) => {
    if ("separator" in entry || !(entry.id in SHARED_VERBS)) return [];
    const label = SHARED_VERBS[entry.id];
    return [label === null || label === undefined ? entry : { ...entry, label }];
  });
}

/**
 * Where a Mate's menu acts: its environment — its socket's, else the one HQ names — when the
 * chat its row reads last finished, for *Mark as unread*: this page's shell of it, else HQ's word,
 * and the run *Stop* interrupts while that chat works.
 */
export function mateMenuTarget(input: {
  /** Its socket's environment, where this page holds one. */
  readonly environmentId: EnvironmentId | undefined;
  /** HQ's word of it, where HQ holds one. */
  readonly told: MateLiveView | undefined;
  readonly activity: ZeropsAgentActivity | undefined;
  /** Each chat's last finished turn as this page's shells hold it, by thread key. */
  readonly completedAt: ReadonlyMap<string, string>;
}): {
  readonly environmentId: EnvironmentId | undefined;
  readonly finished: string | undefined;
  readonly stop:
    | { readonly environmentId: EnvironmentId; readonly input: { readonly threadId: ThreadId } }
    | undefined;
} {
  const { activity, told } = input;
  const environmentId = input.environmentId ?? told?.identity?.environmentId;
  const toldFinished =
    activity !== undefined && told?.main?.id === activity.threadId
      ? (told.main.latestTurn?.completedAt ?? undefined)
      : undefined;
  return {
    environmentId,
    finished:
      activity === undefined
        ? undefined
        : (input.completedAt.get(activity.threadKey) ?? toldFinished),
    stop:
      environmentId === undefined || activity === undefined || activity.face !== "working"
        ? undefined
        : { environmentId, input: { threadId: activity.threadId } },
  };
}

export function useSidebarMateMenus(input: {
  /** Every conversation's shell: what *Mark as unread* marks is its last finished turn. */
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}): {
  readonly getMateActions: (
    candidate: ZeropsCandidatePresentation,
    activity: ZeropsAgentActivity | undefined,
  ) => MateRowActions | undefined;
  readonly dialogs: ReactNode;
} {
  const { serverVersions } = useZeropsContainers();
  const registry = useZeropsRegistry();
  const mateActions = useMateActions({ registry, serverVersions });
  // Each drawn row holds the project detail needed to decide the viewer’s access.
  const drawnOf = useDrawnProjectAccess();
  const { muted, toggle } = useMutedMates();
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const interrupt = useMateCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const router = useRouter();
  const hq = useAtomValue(hqMatesAtom);
  const { copyToClipboard } = useCopyToClipboard<{ readonly name: string }>({
    onCopy: ({ name }) => {
      toastManager.add({ type: "success", title: `Link to ${name} copied` });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy the link",
        description: error.message,
      });
    },
  });

  // A refused write says so once, where it happened is the row's own business.
  useEffect(() => {
    if (mateActions.trouble !== null) {
      toastManager.add({ type: "error", title: mateActions.trouble });
    }
  }, [mateActions.trouble]);

  const completedAt = useMemo(() => {
    const byThread = new Map<string, string>();
    for (const thread of input.threads) {
      const at = thread.latestTurn?.completedAt;
      if (at !== null && at !== undefined) byThread.set(`${thread.environmentId}:${thread.id}`, at);
    }
    return byThread;
  }, [input.threads]);

  const getMateActions = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      activity: ZeropsAgentActivity | undefined,
    ): MateRowActions | undefined => {
      const { environmentId, finished, stop } = mateMenuTarget({
        environmentId: candidate.environmentId,
        told: hq?.mates?.get(candidate.project.id),
        activity,
        completedAt,
      });
      const tags = readZeropsMembership(candidate.project);
      const name = projectNameInApp(candidate.project);
      const threadRef =
        environmentId === undefined || activity === undefined
          ? undefined
          : scopeThreadRef(environmentId, activity.threadId);
      return {
        muted: environmentId !== undefined && muted.includes(environmentId),
        toggleMute:
          environmentId === undefined
            ? undefined
            : () => {
                toggle(environmentId);
              },
        toggleUnread:
          activity === undefined || finished === undefined
            ? undefined
            : () => {
                if (activity.unread)
                  markThreadVisited(activity.threadKey, new Date().toISOString());
                else markThreadUnread(activity.threadKey, finished);
              },
        copyLink:
          threadRef === undefined
            ? undefined
            : () => {
                const { href } = router.buildLocation({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(threadRef),
                });
                copyToClipboard(new URL(href, window.location.origin).toString(), { name });
              },
        rename: mateActions.renameInPlace(candidate),
        changeFace: mateActions.changeFace(candidate),
        stop:
          stop === undefined
            ? undefined
            : () => {
                void interrupt(stop).then((result) => {
                  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                    const error = squashAtomCommandFailure(result);
                    toastManager.add({
                      type: "error",
                      title: `Could not stop ${name}`,
                      ...(error instanceof Error ? { description: error.message } : {}),
                    });
                  }
                });
              },
        entries: sidebarMateVerbs(mateActions.actionsFor(candidate, tags)),
        drawn: drawnOf(candidate.project.id),
      };
    },
    [
      completedAt,
      copyToClipboard,
      drawnOf,
      hq,
      interrupt,
      markThreadUnread,
      markThreadVisited,
      mateActions,
      muted,
      router,
      toggle,
    ],
  );

  return { getMateActions, dialogs: mateActions.dialogs };
}
