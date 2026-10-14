import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberPage } from "../components/settings/TeamMemberPage";

export const Route = createFileRoute("/settings/team_/$clientUserId")({
  component: function TeamMemberRoute() {
    const { clientUserId } = Route.useParams();
    return <TeamMemberPage clientUserId={clientUserId} />;
  },
});
