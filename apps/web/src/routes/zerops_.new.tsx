import { createFileRoute } from "@tanstack/react-router";

import { ZeropsNewProjectRoute } from "../components/zerops/ZeropsNewProjectHost";

/**
 * `/zerops/new`: New project, as a page in the main column beside the menu. Every door asks for it
 * (`newProjectAsk.ts`) and lands here; a link or a bookmark to it opens it too.
 */
export const Route = createFileRoute("/zerops_/new")({
  component: ZeropsNewProjectRoute,
});
