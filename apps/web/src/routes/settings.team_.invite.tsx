import { createFileRoute } from "@tanstack/react-router";

import { TeamInvitePage } from "../components/settings/TeamInvitePage";

export const Route = createFileRoute("/settings/team_/invite")({
  // `?project=<group id>`: the project the invitation was opened from, picked to start with.
  validateSearch: (raw: Record<string, unknown>): { project?: string } =>
    typeof raw.project === "string" && raw.project.length > 0 ? { project: raw.project } : {},
  component: TeamInvitePage,
});
