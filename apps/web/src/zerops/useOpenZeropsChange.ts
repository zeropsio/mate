/**
 * A change's address at HQ, opened on the change's own page here.
 *
 * A Mate writes its change's address into its conversation — the address HQ redirects into this
 * app — so a link to the organization's *official* HQ is read back as the change it names and
 * opened in place; anything else is left exactly as it was.
 *
 * It is an `AppLinkResolver`: it answers with the way to open a link it can take, and with `null`
 * for every other address, so a caller falls through to its normal external open without having
 * to know why. Outside a Zerops session, or until the official HQ is known, it takes nothing.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseChangeUrl } from "@t3tools/shared/hqChanges";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { useHqAddress } from "./projectFlows";

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
  const hqAddress = useHqAddress();
  return useCallback(
    (href) => {
      if (hqAddress === undefined) return null;
      // The address names the change's application, which is its group.
      const link = parseChangeUrl(href, hqAddress);
      if (link === null) return null;
      const change = { groupId: link.appId, repository: link.repo, number: link.number };
      if (threadRef) {
        const ref = threadRef;
        return () => {
          useRightPanelStore.getState().openChange(ref, change);
        };
      }
      return () => {
        void navigate({
          to: "/change/$groupId/$repository/$number",
          params: { ...change, number: String(change.number) },
        });
      };
    },
    [hqAddress, navigate, threadRef],
  );
}
