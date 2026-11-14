import { createFileRoute } from "@tanstack/react-router";

import { ActivitySettings } from "../components/settings/ActivitySettings";

export const Route = createFileRoute("/settings/activity")({
  component: ActivitySettings,
});
