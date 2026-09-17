import { createFileRoute, redirect } from "@tanstack/react-router";

import { ZeropsGiteaPage } from "../components/zerops/ZeropsGiteaPage";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

export const Route = createFileRoute("/gitea")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: ZeropsGiteaPage,
});
