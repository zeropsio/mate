import { createFileRoute } from "@tanstack/react-router";

import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";
import {
  parseProjectsSearch,
  type ProjectsSearch,
} from "../components/zerops/projects/projectsView.logic";

export const Route = createFileRoute("/zerops")({
  // `?group=<groupId>` opens that project's row and scrolls it into view.
  validateSearch: (raw: Record<string, unknown>): ProjectsSearch => parseProjectsSearch(raw),
  component: ZeropsRoute,
});

function ZeropsRoute() {
  return <ZeropsHostedLanding />;
}
