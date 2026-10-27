/**
 * A menu item that says why it stands off: its reason under its label, muted, and its accessible
 * description — a disabled item takes no pointer, so a tooltip would never be seen.
 */
import { useId, type ReactNode } from "react";

import { MenuItem, MenuItemText } from "../ui/menu";

export function MenuItemWithWhy({
  label,
  why,
  ...props
}: Omit<React.ComponentProps<typeof MenuItem>, "children" | "title"> & {
  readonly label: ReactNode;
  readonly why: string | undefined;
}) {
  const id = useId();
  if (why === undefined) return <MenuItem {...props}>{label}</MenuItem>;
  return (
    <MenuItem {...props} aria-describedby={id}>
      <MenuItemText description={why} descriptionId={id} label={label} />
    </MenuItem>
  );
}
