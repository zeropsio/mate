import { createFileRoute } from "@tanstack/react-router";

import { validateKitSearch } from "../kit/kitAppearance";
import { KitPage } from "../kit/KitPage";

// Unlisted: nothing links here. It renders before the account (`-accountGate.ts`), fixtures only.
export const Route = createFileRoute("/kit")({
  validateSearch: validateKitSearch,
  component: KitRouteView,
});

function KitRouteView() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <KitPage
      view={search.appearance}
      pane={search.pane === true}
      onViewChange={(appearance) =>
        void navigate({ search: (previous) => ({ ...previous, appearance }), replace: true })
      }
    />
  );
}
