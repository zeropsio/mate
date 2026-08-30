import { createFileRoute, redirect } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";
import { resolveDoor } from "./-door";

export const Route = createFileRoute("/usage")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: 0,
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: UsagePage,
});
