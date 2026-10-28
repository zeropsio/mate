import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AutomationSettings } from "../components/settings/AutomationSettings";
import type { GithubReturn } from "../components/settings/automationSettings.logic";

type GithubReturned = Exclude<GithubReturn, null>;

function AutomationSettingsPage() {
  const { github } = Route.useSearch();
  // Read once: the address drops it (replaced, not pushed), so a reload or Back says it no more.
  const [returned] = useState(github ?? null);
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (github !== undefined) void navigate({ search: {}, replace: true });
  }, [github, navigate]);
  return <AutomationSettings returned={returned} />;
}

export const Route = createFileRoute("/settings/automation")({
  // `?github=connected`: GitHub brought the person back once the organization's app was made;
  // `?github=requested`: GitHub asked an owner of the organization to approve it first;
  // `?github=waiting`: GitHub installed it where nobody here started it, so it waits for an OK.
  validateSearch: (raw: Record<string, unknown>): { github?: GithubReturned } =>
    raw.github === "connected" || raw.github === "requested" || raw.github === "waiting"
      ? { github: raw.github }
      : {},
  component: AutomationSettingsPage,
});
