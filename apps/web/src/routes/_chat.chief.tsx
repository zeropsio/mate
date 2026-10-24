import { createFileRoute } from "@tanstack/react-router";

import { ChiefPage } from "../components/zerops/chief/ChiefPage";

/**
 * The organization's Chief while there is no conversation of it to open: what a Chief is and its setup,
 * then its own view while it comes up, which hands over to its conversation (`ChiefPage`).
 */
export const Route = createFileRoute("/_chat/chief")({
  component: ChiefPage,
});
