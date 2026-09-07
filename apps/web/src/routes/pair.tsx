import { createFileRoute, redirect } from "@tanstack/react-router";

// Old bookmarks discard their credential without ever exchanging it.
export const Route = createFileRoute("/pair")({
  beforeLoad: () => {
    window.history.replaceState(null, "", window.location.pathname);
    throw redirect({ to: "/zerops", replace: true });
  },
});
