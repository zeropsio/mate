import { type ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import { useOrgOffers } from "~/zerops/useHqOffers";

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
  // HQ offers renaming it (`rename_app`); while HQ has not said or does not answer, drawn and not
  // pressable; where HQ refuses it, not drawn.
  const rename = useOrgOffers()("rename_app").kind;
  const mayRename = rename === "allowed";
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <ZeropsProjectMenu
        actions={[
          ...(rename !== "refused"
            ? [
                {
                  id: "rename-group",
                  label: "Rename project",
                  disabled: !mayRename,
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
