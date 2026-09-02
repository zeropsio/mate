import { createFileRoute } from "@tanstack/react-router";

import { ZeropsNewProjectWizard } from "../components/zerops/ZeropsNewProjectWizard";

export const Route = createFileRoute("/zerops_/new")({
  component: ZeropsNewProjectWizard,
});
