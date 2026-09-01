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
  const onAuthenticated = () => {
    void navigate({ to: "/", replace: true });
  };

  if (door.redirect !== null) {
    // `beforeLoad` throws this same decision's redirect; this is the exhaustive fallback.
    return <Navigate to={door.redirect} replace />;
  }

  switch (door.surface) {
    case "hosted-pairing":
      return <HostedPairingRouteSurface />;

    case "manual-link":
      return (
        <PairingRouteSurface methods={door.manualLink.methods} onAuthenticated={onAuthenticated} />
      );

    case "zerops-onboarding":
      return (
        <PairingRouteSurface methods={door.manualLink!.methods} onAuthenticated={onAuthenticated} />
      );

    case "app":
    case "draft-landing":
    // Unreachable: the door decides the hand-over callback by pathname, and
    // this route is not it. Named rather than left to fall through, so the
    // switch stays total if either path ever moves.
    case "zerops-handover":
      return <Navigate to="/" replace />;
  }
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
