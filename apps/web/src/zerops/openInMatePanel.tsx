/**
 * Opening an address in a Mate's side panel, from a list outside its conversation (a project's
 * Sites). The panel belongs to a conversation and previews only what its Mate knows: its own
 * addresses and its application's stage and production. So an address names the Mates whose panel
 * shows it — a Mate's own address that Mate, a place's every Mate of its application, the viewer's
 * first — and opens in the open conversation's panel where that conversation is one of theirs,
 * otherwise in the first one's main conversation as it opens (`useOpenMate`).
 *
 * Where nothing provides it (a design page), the context is `null` and such a list opens its
 * addresses in a new tab alone.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { createContext, useCallback, type ReactNode } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useOpenMate } from "./useOpenMate";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";

/**
 * Opens an address, by its service, in the side panel of one of `mates` (their own Zerops projects,
 * the one to open first).
 */
export type OpenInMatePanel = (mates: ReadonlyArray<string>, service: string, url: string) => void;

export const OpenInMatePanelContext = createContext<OpenInMatePanel | null>(null);

export function OpenInMatePanelProvider({ children }: { readonly children: ReactNode }) {
  const openRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const openProjectId = useEnvironmentProjectRef(openRef?.environmentId ?? null)?.projectId;
  const openMate = useOpenMate();
  const open = useCallback<OpenInMatePanel>(
    (mates, service, url) => {
      const show = (conversation: ScopedThreadRef) => {
        useRightPanelStore.getState().openService(conversation, service, url);
      };
      const first = mates[0];
      if (openRef !== null && openProjectId !== undefined && mates.includes(openProjectId))
        show(openRef);
      else if (first !== undefined) openMate({ projectId: first }, show);
    },
    [openMate, openProjectId, openRef],
  );
  return <OpenInMatePanelContext value={open}>{children}</OpenInMatePanelContext>;
}

/** Open a change's draft beside its Mate's conversation, by change identity alone. */
export function useOpenDraft() {
  const openRef = useParams({ strict: false, select: (params) => resolveThreadRouteRef(params) });
  const openProjectId = useEnvironmentProjectRef(openRef?.environmentId ?? null)?.projectId;
  const openMate = useOpenMate();
  return useCallback(
    (
      projectId: string,
      change: { readonly groupId: string; readonly repository: string; readonly number: number },
    ) => {
      const show = (conversation: ScopedThreadRef) =>
        useRightPanelStore.getState().openDraft(conversation, change);
      if (openRef !== null && openProjectId === projectId) show(openRef);
      else openMate({ projectId }, show);
    },
    [openMate, openProjectId, openRef],
  );
}
