/**
 * Opening one of a Mate's addresses in its side panel, from a list outside its conversation (a
 * project's Sites). The panel belongs to a conversation and previews only its Mate's own addresses,
 * so the address opens in the open conversation's panel where that conversation is the Mate's, and
 * otherwise in the Mate's main conversation as it opens (`useOpenMate`).
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

/** Opens a Mate's service address, by the Mate's own Zerops project, in its side panel. */
export type OpenInMatePanel = (mateProjectId: string, service: string, url: string) => void;

export const OpenInMatePanelContext = createContext<OpenInMatePanel | null>(null);

export function OpenInMatePanelProvider({ children }: { readonly children: ReactNode }) {
  const openRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const openProjectId = useEnvironmentProjectRef(openRef?.environmentId ?? null)?.projectId;
  const openMate = useOpenMate();
  const open = useCallback<OpenInMatePanel>(
    (mateProjectId, service, url) => {
      const show = (conversation: ScopedThreadRef) => {
        useRightPanelStore.getState().openService(conversation, service, url);
      };
      if (openRef !== null && openProjectId === mateProjectId) show(openRef);
      else openMate({ projectId: mateProjectId }, show);
    },
    [openMate, openProjectId, openRef],
  );
  return <OpenInMatePanelContext value={open}>{children}</OpenInMatePanelContext>;
}
