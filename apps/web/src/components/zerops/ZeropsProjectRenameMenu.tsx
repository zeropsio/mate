import { canWriteRegistry, type ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import { sessionOfferViewer } from "~/zerops/offerViewer";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsProjectMenu, type ZeropsMenuEntry } from "./ZeropsProjectMenu";
import { ZeropsRenameProjectDialog } from "./ZeropsRenameProjectDialog";

/** The project's rename and form, shared by its row and its detail. */
export function ZeropsProjectRenameMenu({
  group,
  actions = [],
}: {
  readonly group: ZeropsGroup;
  readonly actions?: ReadonlyArray<ZeropsMenuEntry>;
}) {
  const { user, activeOrganization } = useZeropsSession();
  const mayRename = canWriteRegistry(sessionOfferViewer(user, activeOrganization));
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <ZeropsProjectMenu
        actions={[
          ...(mayRename
            ? [
                {
                  id: "rename-group",
                  label: "Rename project",
                  onSelect: () => setRenaming(true),
                },
              ]
            : []),
          ...actions,
        ]}
        label={`More for ${group.name}`}
      />
      {mayRename && renaming ? (
        <ZeropsRenameProjectDialog
          group={group}
          key={`rename-group:${group.groupId}`}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </>
  );
}
