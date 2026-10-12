import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { OverviewFilters } from "./OverviewFilters";
import { parseProjectsSearch } from "./projectsView.logic";

/** The overview's filters over the router's own links, the address opened at `path`. */
async function filtersAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const overview = createRoute({
    getParentRoute: () => root,
    path: "/zerops",
    validateSearch: parseProjectsSearch,
    component: function Overview() {
      const { show } = overview.useSearch();
      return <OverviewFilters mine={10} show={show} waiting={1} />;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([overview]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gu)].map(([, attributes, inner]) => ({
    label: inner!.replace(/<[^>]+>/gu, "").replace(/\d+$/u, ""),
    current: /aria-current="page"/u.test(attributes!),
  }));
}

describe("the overview's filters", () => {
  it.each([
    { path: "/zerops", shown: "All" },
    { path: "/zerops?show=waiting", shown: "Waiting on you" },
    { path: "/zerops?show=mine", shown: "Mine" },
  ])("say the filter shown is the current one, and only it: $shown", async ({ path, shown }) => {
    const links = await filtersAt(path);
    expect(links.map((link) => link.label)).toEqual(["All", "Waiting on you", "Mine"]);
    expect(links.filter((link) => link.current).map((link) => link.label)).toEqual([shown]);
  });
});
