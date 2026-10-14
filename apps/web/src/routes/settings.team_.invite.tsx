import { createFileRoute } from "@tanstack/react-router";

import { TeamInvitePage } from "../components/settings/TeamInvitePage";

export const Route = createFileRoute("/settings/team_/invite")({
  component: TeamInvitePage,
});
