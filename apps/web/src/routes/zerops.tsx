import { createFileRoute } from "@tanstack/react-router";

import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";
import {
  parseProjectsSearch,
  type ProjectsSearch,
} from "../components/zerops/projects/projectsView.logic";

export const Route = createFileRoute("/zerops")({
  // `?view=projects&group=<groupId>` opens the Projects view at that group's
  // card — the way a Mate's conversation points at its project. No view is
  // the Overview.
  validateSearch: (raw: Record<string, unknown>): ProjectsSearch => parseProjectsSearch(raw),
  component: ZeropsRoute,
});

function ZeropsRoute() {
  return <ZeropsHostedLanding />;
}
