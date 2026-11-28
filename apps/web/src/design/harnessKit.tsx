/**
 * The kit on the design harness's own page, where no app runs: the components and the harness's
 * pages as flows, its view in the address like `/kit`'s. Fixtures only: no account, no Mate.
 */
import "../index.css";

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "~/components/ui/tooltip";
import { kitSearchQuery, validateKitSearch, type KitSearch } from "~/kit/kitAppearance";
import { KIT_FLOWS } from "~/kit/kitFlows";
import { KitPage } from "~/kit/KitPage";

const readSearch = (): KitSearch =>
  validateKitSearch(Object.fromEntries(new URLSearchParams(location.search)));

function HarnessKit() {
  const [search, setSearch] = useState(readSearch);
  // Back and forward move between the kit's pages as on `/kit`.
  useEffect(() => {
    const onPop = () => setSearch(readSearch());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <KitPage
      flows={KIT_FLOWS}
      onSearchChange={(next, mode) => {
        const query = kitSearchQuery(next);
        const address = `${location.pathname}${query === "" ? "" : `?${query}`}`;
        if (mode === "push") history.pushState(null, "", address);
        else history.replaceState(null, "", address);
        setSearch(next);
      }}
      search={search}
    />
  );
}

const router = createRouter({
  routeTree: createRootRoute({ component: HarnessKit }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

document.title = "Mate — Kit";

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </StrictMode>,
  );
}
