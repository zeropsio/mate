import { createFileRoute, redirect } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

export const Route = createFileRoute("/usage")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: UsagePage,
});
