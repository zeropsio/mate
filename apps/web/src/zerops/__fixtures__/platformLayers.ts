/**
 * Product children that carry platform text outside the page itself: an open
 * dialog, which renders into a portal beside the page, and the document title.
 *
 * A harness tab imports it after its module graph is reset, so every module it
 * renders is the tab's own.
 */
import { createElement, useEffect } from "react";

import { Dialog, DialogPopup } from "../../components/ui/dialog";
import { useZeropsInventory } from "../inventoryContext";

const projectNames = (projects: ReadonlyArray<{ readonly name: string }>) =>
  projects.map(({ name }) => name).join(", ");

/** An open dialog naming the inventory's projects. */
export function ProjectDialog() {
  const names = projectNames(useZeropsInventory().projects);
  return createElement(
    Dialog,
    { open: true },
    createElement(DialogPopup, null, `dialog: ${names}`),
  );
}

/** Names the inventory's projects in the document title. */
export function ProjectTitle() {
  const names = projectNames(useZeropsInventory().projects);
  useEffect(() => {
    document.title = `${names} · Zerops Mate`;
  }, [names]);
  return null;
}
