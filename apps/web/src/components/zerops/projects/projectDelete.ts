/** A project's Delete on Overview opens the shared project deletion page. */
import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";
import type { HqOfferState } from "@t3tools/shared/hqOffers";

import type { ZeropsMenuEntry } from "../ZeropsProjectMenu";
import { projectDeleteOnOverview } from "./emptyApps.logic";

export function projectDeleteActions(input: {
  readonly group: Pick<CanonicalGroup, "groupId" | "name" | "pending" | "environments">;
  /** HQ's word on `delete_app`: drawn unless refused, pressable once allowed. */
  readonly offer: HqOfferState["kind"];
  readonly openDeletion: () => void;
}): ReadonlyArray<ZeropsMenuEntry> {
  const { group } = input;
  const offered = projectDeleteOnOverview(group, input.offer);
  if (offered === undefined) return [];
  return [
    {
      id: "delete-group",
      label: `Delete ${group.name}…`,
      variant: "destructive",
      disabled: offered === "waits",
      onSelect: input.openDeletion,
    },
  ];
}
