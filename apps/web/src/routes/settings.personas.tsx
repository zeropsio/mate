import { createFileRoute } from "@tanstack/react-router";

import { PersonasSettings } from "../components/settings/PersonasSettings";

export const Route = createFileRoute("/settings/personas")({
  component: PersonasSettings,
});
