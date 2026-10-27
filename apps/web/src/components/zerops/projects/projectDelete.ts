/**
 * A project's *Delete* on the projects page, where it has no Mate (`deleteOffered`): one HQ says holds nothing opens the page's own dialog (`openEmpty`); one
 * holding code or changes opens the menu's dialog that lists what goes with it and deletes it with
 * its code (`useDeleteApplicationDialog`), the same dialog and the same deletion as the menu's.
 */
import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import type { HqOfferState } from "@t3tools/shared/hqOffers";

import { useDeleteApplicationDialog } from "~/zerops/deleteApplicationDialog";

import { groupDeletionTarget } from "../ZeropsDeleteApplicationDialog.logic";
import type { ZeropsMenuEntry } from "../ZeropsProjectMenu";
import { deleteOffered } from "./emptyApps.logic";

export function projectDeleteActions(input: {
  readonly group: Pick<CanonicalGroup, "groupId" | "name" | "pending" | "environments">;
  /** HQ's word on `delete_app`: drawn unless refused, pressable once allowed. */
  readonly offer: HqOfferState["kind"];
  readonly contents: HqAppContents | undefined;
  readonly openEmpty: () => void;
}): ReadonlyArray<ZeropsMenuEntry> {
  const { group } = input;
  const offered = deleteOffered(group, input.offer !== "refused", input.contents);
  if (offered === undefined) return [];
  return [
    {
      id: "delete-group",
      label: `Delete ${group.name}…`,
      variant: "destructive",
      // While HQ has not said or does not answer, drawn and not pressable.
      disabled: input.offer !== "allowed",
      onSelect: () => {
        if (offered === "empty") input.openEmpty();
        else useDeleteApplicationDialog.getState().open({ target: groupDeletionTarget(group) });
      },
    },
  ];
}
