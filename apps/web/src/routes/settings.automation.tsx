import { createFileRoute } from "@tanstack/react-router";

import { AutomationSettings } from "../components/settings/AutomationSettings";

function AutomationSettingsPage() {
  const { github } = Route.useSearch();
  return <AutomationSettings returned={github === "connected"} />;
}

export const Route = createFileRoute("/settings/automation")({
  // `?github=connected`: GitHub brought the person back once the organization's app was made.
  validateSearch: (raw: Record<string, unknown>): { github?: "connected" } =>
    raw.github === "connected" ? { github: "connected" } : {},
  component: AutomationSettingsPage,
});
