/**
 * The quiet actions on a projects-screen row and on a group header. One
 * trigger, a short menu; what each item does belongs to the caller.
 */
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export interface ZeropsMenuAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

export function ZeropsProjectMenu({
  label,
  actions,
}: {
  /** What the trigger is for, read by assistive tech. */
  readonly label: string;
  readonly actions: ReadonlyArray<ZeropsMenuAction>;
}): ReactNode {
  if (actions.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={label}
            className="size-7 text-muted-foreground"
            size="icon"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        {actions.map((action) => (
          <MenuItem key={action.id} onClick={action.onSelect}>
            {action.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
