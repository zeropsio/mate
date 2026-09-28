/**
 * The left menu comes out to show what a surface asked it to show.
 *
 * A reveal (`sidebarPeek.ts`) is answered by the tree, and the tree is only
 * drawn while the menu is: a phone's menu is a sheet that steps aside for the
 * jump box, and a collapsed menu is out of sight. So an ask opens the menu —
 * the sheet on a phone, the panel on a desktop — and the tree, drawn again,
 * answers it. On the settings pages the menu is the settings' own and shows
 * no tree: the jump box opens a thing's own page there instead
 * (`sidebarJump.ts`'s `showable`).
 *
 * Lives inside the sidebar's provider, beside its toggle, because only there
 * can the menu be opened.
 */
import { useEffect, useRef } from "react";

import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarPeek } from "~/zerops/sidebarPeek";

import { useSidebar } from "../ui/sidebar";

export function SidebarRevealBridge({ showable }: { readonly showable: boolean }) {
  const { isMobile, openMobile, setOpenMobile, open, setOpen } = useSidebar();
  const seq = useSidebarPeek((state) => state.revealing?.seq ?? null);
  const answered = useRef<number | null>(null);

  useEffect(() => {
    useSidebarJump.getState().setShowable(showable);
  }, [showable]);
  useEffect(
    () => () => {
      useSidebarJump.getState().setShowable(false);
    },
    [],
  );

  useEffect(() => {
    if (seq === null || seq === answered.current || !showable) return;
    answered.current = seq;
    if (isMobile) {
      if (!openMobile) setOpenMobile(true);
    } else if (!open) {
      void setOpen(true);
    }
  }, [isMobile, open, openMobile, seq, setOpen, setOpenMobile, showable]);

  return null;
}
