import { createFileRoute } from "@tanstack/react-router";

import { ZeropsSettings } from "../components/settings/ZeropsSettings";

export const Route = createFileRoute("/settings/zerops")({
  component: ZeropsSettings,
});
