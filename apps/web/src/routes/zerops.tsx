import { createFileRoute, redirect } from "@tanstack/react-router";

import { ZeropsProjectsPage } from "../components/zerops/ZeropsProjectsPage";
import { resolveDoor } from "./-door";

export const Route = createFileRoute("/zerops")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: 0,
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: ZeropsProjectsPage,
});
