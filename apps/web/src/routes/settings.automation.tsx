import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AutomationSettings } from "../components/settings/AutomationSettings";
import {
  githubReturnedApp,
  type GithubReturn,
} from "../components/settings/automationSettings.logic";

type GithubReturned = Exclude<GithubReturn, null>;

function AutomationSettingsPage() {
  const { github, "github-app": githubApp } = Route.useSearch();
  // Read once: the address drops it (replaced, not pushed), so a reload or Back says it no more.
  const [returned] = useState(github ?? null);
  const [returnedApp] = useState(githubApp ?? null);
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (github !== undefined || githubApp !== undefined)
      void navigate({ search: {}, replace: true });
  }, [github, githubApp, navigate]);
  return <AutomationSettings returned={returned} returnedApp={returnedApp} />;
}

export const Route = createFileRoute("/settings/automation")({
  // `?github=connected`: GitHub brought the person back once the organization's app was made;
  // `?github=requested`: GitHub asked an owner of the organization to approve it first;
  // `?github=waiting`: GitHub installed it where nobody here started it, so it waits for an OK.
  // `?github-app=<id>`: the app whose install trip it was, beside any of them.
  validateSearch: (
    raw: Record<string, unknown>,
  ): { github?: GithubReturned; "github-app"?: number } => {
    const app = githubReturnedApp(raw["github-app"]);
    return {
      ...(raw.github === "connected" || raw.github === "requested" || raw.github === "waiting"
        ? { github: raw.github }
        : {}),
      ...(app === null ? {} : { "github-app": app }),
    };
  },
  component: AutomationSettingsPage,
});
