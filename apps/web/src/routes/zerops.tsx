import { createFileRoute } from "@tanstack/react-router";

import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";

export const Route = createFileRoute("/zerops")({
  component: ZeropsRoute,
});

function ZeropsRoute() {
  return <ZeropsHostedLanding exclusive manualFallback={null} />;
}
