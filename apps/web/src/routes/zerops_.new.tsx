import { createFileRoute, redirect } from "@tanstack/react-router";

import { askNewProject } from "../zerops/newProjectAsk";

/**
 * `/zerops/new`, the page New project used to be: it asks for the New project dialog and hands
 * the route to the projects page, over which the dialog opens (`ZeropsNewProjectHost`) — so a
 * link or a bookmark to it still opens New project. A preload asks for nothing.
 */
export const Route = createFileRoute("/zerops_/new")({
  beforeLoad: ({ preload }) => {
    if (!preload) askNewProject();
    throw redirect({ to: "/zerops", replace: true });
  },
});
