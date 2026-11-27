/**
 * Where a link to one of a Mate's draft addresses goes in its conversation (`draftAddress`): its
 * draft while that draft is open, else the same page of Your app, else nowhere — never the
 * address of a container that went back to the pool.
 */
import { readZeropsMembership } from "@t3tools/client-runtime/zerops";
import { draftAddress } from "@t3tools/client-runtime/zerops/draftAddress";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { useMateOfEnvironment } from "./accountEnvironments";
import { useAppsChanges } from "./projectFlows";
import { useMatesLeases } from "./useMatesLeases";
import { useZeropsDetailCandidates } from "./useZeropsCandidates";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

/** A draft address's link: where it opens, or none (`href` undefined) where nothing should open. */
export type DraftAddressLink =
  | { readonly href: string; readonly open: () => void }
  | { readonly href: undefined };

/** Null for an address that is no draft's: the link stays as it is. */
export type DraftAddressResolver = (url: string) => DraftAddressLink | null;

const NO_LINK: DraftAddressLink = { href: undefined };

export function useDraftAddresses(threadRef: ScopedThreadRef | null): DraftAddressResolver {
  const inventory = useZeropsInventory();
  const projectId = useMateOfEnvironment(threadRef?.environmentId)?.projectId;
  const project = inventory.projects.find((entry) => entry.id === projectId);
  const groupId = readZeropsMembership(project).groupId ?? undefined;
  const { changes } = useAppsChanges(
    useMemo(() => (groupId === undefined ? [] : [groupId]), [groupId]),
  );
  const pullRequests = groupId === undefined ? undefined : changes.get(groupId)?.pullRequests;
  const copies = useMatesLeases(
    useMemo(() => (projectId === undefined ? [] : [{ projectId }]), [projectId]),
  )[projectId ?? ""];
  const { listing } = useZeropsDetailCandidates();
  const row = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
  const pools = row?.services?.pools;
  const routes = row?.routes;
  const leases = copies?.leases;
  const poolPairs = copies?.poolPairs;
  const mine = useMemo(
    () =>
      (pullRequests ?? []).flatMap((pull) =>
        pull.kind === "code" && pull.mateProjectId === projectId && !pull.merged
          ? [
              {
                pull,
                state:
                  pull.state === "adding" || pull.state === "merging"
                    ? pull.state
                    : ("open" as const),
                mateGone: pull.mateGone === true,
                branch: pull.branch,
                repositoryUrl: pull.repositoryUrl,
              },
            ]
          : [],
      ),
    [projectId, pullRequests],
  );
  return useCallback<DraftAddressResolver>(
    (url) => {
      if (threadRef === null) return null;
      const look = draftAddress({
        url,
        pools,
        leases,
        poolPairs,
        routes: routes ?? [],
        changes: mine,
      });
      if (look === undefined) return null;
      const panel = useRightPanelStore.getState();
      switch (look.kind) {
        case "draft": {
          if (groupId === undefined) return null;
          const { repository, number } = look.change.pull;
          return {
            href: url,
            open: () => panel.openDraft(threadRef, { groupId, repository, number }),
          };
        }
        case "app":
          return {
            href: look.url,
            open: () => panel.openService(threadRef, look.service, look.url),
          };
        case "none":
          return NO_LINK;
      }
    },
    [groupId, leases, mine, poolPairs, pools, routes, threadRef],
  );
}
