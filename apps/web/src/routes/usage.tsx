import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { UsagePage } from "../components/usage/UsagePage";
import type { UsageScope } from "../components/usage/usageDimensions";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";
import { validateUsageSearch } from "./-usageSearch";

function UsageRoute() {
  const scope = Route.useSearch();
  const navigate = useNavigate({ from: "/usage" });
  const changeScope = useCallback(
    (next: UsageScope) => {
      void navigate({
        search: {
          ...(next.person === undefined ? {} : { person: next.person }),
          ...(next.project === undefined ? {} : { project: next.project }),
          ...(next.mate === undefined ? {} : { mate: next.mate }),
        },
      });
    },
    [navigate],
  );
  return <UsagePage scope={scope} onScopeChange={changeScope} />;
}

export const Route = createFileRoute("/usage")({
  validateSearch: validateUsageSearch,
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: UsageRoute,
});
