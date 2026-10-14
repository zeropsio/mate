import { createFileRoute } from "@tanstack/react-router";

import { TeamSettings } from "../components/settings/TeamSettings";

export const Route = createFileRoute("/settings/team")({
  component: TeamSettings,
});
