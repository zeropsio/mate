/**
 * A stand-in for the app's route tree under `AppRoot`: the projects page and
 * a project's page, over a memory history opened at the tab's path. It says
 * which route rendered, and carries the fixture's session probe at its root.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
} from "@tanstack/react-router";
import { createElement, Fragment, type ComponentType } from "react";

import type { AppRouter } from "../../router";

export function productRouter(path: string, Probe: ComponentType): AppRouter {
  const root = createRootRoute({
    component: () => createElement(Fragment, null, createElement(Probe), createElement(Outlet)),
    notFoundComponent: () => "Page not found",
  });
  const projects = createRoute({
    getParentRoute: () => root,
    path: "/zerops",
    component: () => "Your projects",
  });
  const project = createRoute({
    getParentRoute: () => root,
    path: "/zerops/project/$projectId",
    component: function ProjectPage() {
      const { projectId } = useParams({ strict: false });
      return `Project ${projectId}`;
    },
  });
  return createRouter({
    routeTree: root.addChildren([projects, project]),
    history: createMemoryHistory({ initialEntries: [path] }),
  }) as unknown as AppRouter;
}
