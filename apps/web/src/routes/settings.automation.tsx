import { createFileRoute } from "@tanstack/react-router";

import { AutomationSettings } from "../components/settings/AutomationSettings";

function AutomationSettingsPage() {
  const { github } = Route.useSearch();
  return <AutomationSettings returned={github ?? null} />;
}

export const Route = createFileRoute("/settings/automation")({
  // `?github=connected`: GitHub brought the person back once the organization's app was made;
  // `?github=requested`: GitHub asked an owner of the organization to approve it first.
  validateSearch: (raw: Record<string, unknown>): { github?: "connected" | "requested" } =>
    raw.github === "connected" || raw.github === "requested" ? { github: raw.github } : {},
  component: AutomationSettingsPage,
});
