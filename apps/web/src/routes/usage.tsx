import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { UsagePage } from "../components/usage/UsagePage";
import type { UsageScope } from "../components/usage/usageDimensions";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

function presentString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

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
  validateSearch: (raw: Record<string, unknown>): UsageScope => {
    const person = presentString(raw.person);
    const project = presentString(raw.project);
    const mate = presentString(raw.mate);
    return {
      ...(person === undefined ? {} : { person }),
      ...(project === undefined ? {} : { project }),
      ...(mate === undefined ? {} : { mate: EnvironmentId.make(mate) }),
    };
  },
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
