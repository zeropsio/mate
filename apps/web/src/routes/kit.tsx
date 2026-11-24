import { createFileRoute } from "@tanstack/react-router";

import { validateKitSearch } from "../kit/kitAppearance";
import { KitPage } from "../kit/KitPage";
import { KIT_FLOWS } from "../kit/kitFlows";

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
      flows={KIT_FLOWS}
      onSearchChange={(next, mode) => void navigate({ search: next, replace: mode === "replace" })}
      search={search}
    />
  );
}
