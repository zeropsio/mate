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
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { validateKitSearch } from "~/kit/kitAppearance";
import { KIT_FLOWS } from "~/kit/kitFlows";
import { KitPage } from "~/kit/KitPage";

type KitSearch = ReturnType<typeof validateKitSearch>;

const readSearch = (): KitSearch =>
  validateKitSearch(Object.fromEntries(new URLSearchParams(location.search)));

const writeSearch = ({ appearance, pane, flow }: KitSearch) => {
  const params = new URLSearchParams();
  if (appearance !== undefined) params.set("appearance", appearance);
  if (pane === true) params.set("pane", "true");
  if (flow !== undefined) params.set("flow", flow);
  history.replaceState(null, "", `${location.pathname}${params.size > 0 ? `?${params}` : ""}`);
};

function HarnessKit() {
  const [search, setSearch] = useState(readSearch);
  const update = (next: KitSearch) => {
    writeSearch(next);
    setSearch(next);
  };
  return (
    <KitPage
      view={search.appearance}
      pane={search.pane === true}
      onViewChange={(appearance) => update({ ...search, appearance })}
      flows={KIT_FLOWS}
      flow={search.flow}
      onFlowChange={(flow) => {
        const { flow: _shown, ...rest } = search;
        update(flow === undefined ? rest : { ...rest, flow });
      }}
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
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
