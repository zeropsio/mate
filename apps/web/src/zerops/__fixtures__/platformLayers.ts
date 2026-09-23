/**
 * Product children that carry platform text outside the page itself: an open
 * dialog, which renders into a portal beside the page, and the document title.
 *
 * A harness tab imports it after its module graph is reset, so every module it
 * renders is the tab's own.
 */
import { createElement, useEffect, useState } from "react";

import { Dialog, DialogPopup } from "../../components/ui/dialog";
import { useProjectDialog, useZeropsInventory } from "../inventoryContext";

const projectNames = (projects: ReadonlyArray<{ readonly name: string }>) =>
  projects.map(({ name }) => name).join(", ");

/**
 * A dialog opened on the first project once the inventory lists it, naming every project as they
 * stood then: what it shows is held in its own state, as a product dialog holds its candidate.
 */
export function ProjectDialog() {
  const { projects } = useZeropsInventory();
  const [opened, setOpened] = useState(false);
  const [dialog, setDialog] = useProjectDialog(
    (held: { readonly projectId: string; readonly names: string }) => held.projectId,
  );
  const first = projects[0];
  if (!opened && first !== undefined) {
    setOpened(true);
    setDialog({ projectId: first.id, names: projectNames(projects) });
  }
  if (dialog === null) return null;
  return createElement(
    Dialog,
    { open: true },
    createElement(DialogPopup, null, `dialog: ${dialog.names}`),
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
