/**
 * A Gitea change link, opened on the change's own page instead of in a forge.
 *
 * A Mate writes the forge's url into its conversation, and every surface that
 * drew it sent the reader out to a Gitea they have to sign into — for a change
 * this app draws in full (the owner, 2026-09-19). So a link to *this account's*
 * Gitea is read back as the change it names and opened here; anything else is
 * left exactly as it was.
 *
 * It is an `AppLinkResolver`: it answers with the way to open a link it can
 * take, and with `null` for every other address, so a caller falls through to
 * its normal external open without having to know why. Outside a Zerops
 * session there is no flow to ask, and it takes nothing.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseGiteaChangeUrl } from "@t3tools/client-runtime/zerops";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { useZeropsProjectFlowOptional } from "./projectFlowContext";

/**
 * `threadRef` is what decides where the change is drawn. Inside a conversation
 * it opens as a tab beside it, so the reader keeps the message that named it;
 * with no conversation to sit beside — the projects page, a link followed cold
 * — it takes the page instead.
 */
export function useOpenZeropsChange(
  threadRef?: ScopedThreadRef | null,
): (href: string) => (() => void) | null {
  const navigate = useNavigate();
  const flow = useZeropsProjectFlowOptional();
  const giteaOrigin = flow?.giteaOrigin;
  const slugs = flow?.slugs;
  return useCallback(
    (href) => {
      const link = parseGiteaChangeUrl(href, giteaOrigin);
      if (link === null || slugs === undefined) return null;
      // The url carries the Gitea org, which is a group's slug; the route takes
      // the group's id. Only a slug this account actually holds is claimed.
      let groupId: string | undefined;
      for (const [id, slug] of slugs) {
        if (slug === link.owner) {
          groupId = id;
          break;
        }
      }
      if (groupId === undefined) return null;
      const target = groupId;
      if (threadRef) {
        const ref = threadRef;
        return () => {
          useRightPanelStore.getState().openChange(ref, {
            groupId: target,
            repository: link.repository,
            number: link.number,
          });
        };
      }
      return () => {
        void navigate({
          to: "/change/$groupId/$repository/$number",
          params: {
            groupId: target,
            repository: link.repository,
            number: String(link.number),
          },
        });
      };
    },
    [giteaOrigin, navigate, slugs, threadRef],
  );
}
