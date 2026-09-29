/**
 * What a Mate's own menu in the left menu does, wired to the session.
 *
 * The verbs the projects screen offers too — *Restart* or *Start*, *Register
 * in …*, *Hand over…*, *Move to project…*, *Delete {name}…* — are
 * `useMateActions`', one definition with its dialogs; *Rename* is its write
 * too, done where the name stands instead of in a dialog, and *Change face…*
 * its dialog, placed beside *Rename*. The rest is this viewer's own: a mute
 * this browser keeps (`mutedMates.ts`), read or unread (the visit marks the
 * thread rows use), a link to the conversation, and stopping the run it is on
 * — which the server leaves open to every member, a colleague having to be
 * able to stop an agent they may not start.
 *
 * The group registry is read only once somebody opens a Mate's menu: it is
 * what *Register in …* needs, and the menu is on every screen.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { botDisplayName, readZeropsGroupTags } from "@t3tools/client-runtime/zerops";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import type { ZeropsMenuEntry } from "~/components/zerops/ZeropsProjectMenu";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";

import type { ZeropsAgentActivity } from "./agentActivity";
import { useAccountGitea } from "./giteaProject";
import { useMateActions } from "./useMateActions";
import { useMutedMates } from "./mutedMates";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { useZeropsContainers } from "./zeropsContainers";

/** The shared verbs this menu carries, relabelled for a Mate's own menu. */
const SHARED_VERBS: Readonly<Record<string, string | null>> = {
  start: null,
  restart: null,
  register: null,
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
  const { activeOrganization, status } = useZeropsSession();
  const { serverVersions } = useZeropsContainers();
  const giteaProjectId = useAccountGitea(activeOrganization?.id)?.projectId;
  const [registryWanted, setRegistryWanted] = useState(false);
  const registry = useZeropsRegistry({
    giteaProjectId,
    enabled: registryWanted && status === "signed-in",
  });
  const mateActions = useMateActions({ registry, serverVersions });
  const { muted, toggle } = useMutedMates();
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const router = useRouter();
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
      const environmentId = candidate.environmentId;
      const tags = readZeropsGroupTags(candidate.project.tagList);
      const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
      const threadRef =
        environmentId === undefined || activity === undefined
          ? undefined
          : scopeThreadRef(environmentId, activity.threadId);
      const finished = activity === undefined ? undefined : completedAt.get(activity.threadKey);
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
          environmentId === undefined || activity === undefined || activity.face !== "working"
            ? undefined
            : () => {
                void interrupt({
                  environmentId,
                  input: { threadId: activity.threadId },
                }).then((result) => {
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
        onMenuOpen: () => {
          setRegistryWanted(true);
        },
      };
    },
    [
      completedAt,
      copyToClipboard,
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
