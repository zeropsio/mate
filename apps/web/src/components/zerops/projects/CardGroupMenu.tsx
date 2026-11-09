/**
 * A project card's ···: the project's own verbs (the page's), and production's rarer ones the card
 * no longer carries (P2) — Roll back to the release before, its history on the Production page, and
 * its addresses: *Put it on your domain* while it has none of its own, *Manage addresses* after.
 */
import {
  addresses as placeAddresses,
  lacksOwnDomain,
  PROJECT_ROUTINGS_LISTING,
  type PlaceAddresses,
} from "@t3tools/client-runtime/data";
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useOpenReview } from "~/zerops/review";
import { useProjectRoleOffers } from "~/zerops/usePlatformCapabilities";
import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";

import type { ZeropsMenuEntry } from "../ZeropsProjectMenu";
import { ZeropsProjectRenameMenu } from "../ZeropsProjectRenameMenu";

/** Outside an account, or before production is named: nothing read. */
const NOT_READ = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
  nothingDeployed: false,
});

/** What production's verbs on a card's ··· need (`productionVerbs`). */
export interface CardProductionVerbs {
  readonly projectId: string;
  /** The release a roll back goes to, while production runs well. */
  readonly rollBack: string | undefined;
  /** It has run a release: its history is worth opening. */
  readonly history: boolean;
  /** Something runs there at an address: its addresses can be managed. */
  readonly runs: boolean;
}

export function CardGroupMenu({
  group,
  actions,
  production,
}: {
  readonly group: Pick<ZeropsGroup, "groupId" | "name" | "nameSource">;
  /** The project's own verbs, as the page offers them. */
  readonly actions: ReadonlyArray<ZeropsMenuEntry>;
  readonly production: CardProductionVerbs | undefined;
}) {
  const orgId = useAccountOrgId();
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const projectId = production?.projectId;
  const place = useProjection(
    placeAddresses,
    orgId === null || projectId === undefined ? null : { orgId, projectId },
    NOT_READ,
  );
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    place.readsProject && projectId !== undefined ? projectId : null,
  );
  // None where the viewer's role there changes no address (`projectRoleOffers`).
  const { manageAddresses } = useProjectRoleOffers(projectId);
  const groupId = group.groupId;
  const entries: Array<ZeropsMenuEntry> =
    production === undefined
      ? []
      : [
          ...(production.rollBack === undefined
            ? []
            : [
                {
                  id: "roll-back",
                  label: `Roll back to ${production.rollBack}`,
                  onSelect: () => {
                    openReview({ kind: "rollback", groupId, tag: production.rollBack ?? "" });
                  },
                },
              ]),
          ...(production.history
            ? [
                {
                  id: "production-history",
                  label: "Production history",
                  onSelect: () => {
                    void navigate({
                      to: "/group/$groupId/$projectId",
                      params: { groupId, projectId: production.projectId },
                    });
                  },
                },
              ]
            : []),
          ...(orgId === null || !manageAddresses || !production.runs
            ? []
            : [
                lacksOwnDomain(place)
                  ? {
                      id: "add-domain",
                      label: "Put it on your domain",
                      onSelect: () => {
                        useAddressesSheet.getState().open({
                          orgId,
                          projectId: production.projectId,
                          groupId,
                          intent: "add-domain",
                        });
                      },
                    }
                  : {
                      id: "manage-addresses",
                      label: "Manage addresses",
                      onSelect: () => {
                        useAddressesSheet
                          .getState()
                          .open({ orgId, projectId: production.projectId, groupId });
                      },
                    },
              ]),
        ];
  return (
    <ZeropsProjectRenameMenu
      actions={[
        ...entries,
        ...(entries.length === 0 || actions.length === 0
          ? []
          : [{ id: "production-end", separator: true as const }]),
        ...actions,
      ]}
      group={group}
    />
  );
}
