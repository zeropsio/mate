import { createFileRoute, redirect } from "@tanstack/react-router";

import { ZeropsDeletionPageContainer } from "../components/zerops/ZeropsDeletionPage";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

export const Route = createFileRoute("/projects/$projectKey_/delete")({
  validateSearch: (raw: Record<string, unknown>): { mate?: string } =>
    typeof raw.mate === "string" && raw.mate.length > 0 ? { mate: raw.mate } : {},
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) throw redirect({ to: door.redirect, replace: true });
  },
  component: DeleteProjectRoute,
});

function DeleteProjectRoute() {
  const { projectKey } = Route.useParams();
  const { mate } = Route.useSearch();
  return <ZeropsDeletionPageContainer appId={projectKey} mateId={mate} />;
}
