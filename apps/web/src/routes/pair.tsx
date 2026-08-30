import { createFileRoute, Navigate, redirect, useNavigate } from "@tanstack/react-router";

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import { resolveDoor } from "./-door";

export const Route = createFileRoute("/pair")({
  beforeLoad: ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: 0,
    });

    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }

    return { door };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { door } = Route.useRouteContext();
  const navigate = useNavigate();

  if (door.redirect !== null) {
    // `beforeLoad` throws this same decision's redirect; this is the exhaustive fallback.
    return <Navigate to={door.redirect} replace />;
  }

  switch (door.surface) {
    case "hosted-pairing":
      return <HostedPairingRouteSurface />;

    case "manual-link":
      return (
        <PairingRouteSurface
          methods={door.manualLink.methods}
          onAuthenticated={() => {
            void navigate({ to: "/", replace: true });
          }}
        />
      );

    case "app":
    case "zerops-onboarding":
    case "draft-landing":
      return <Navigate to="/" replace />;
  }
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
