import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
/**
 * The overview's pieces the menu keeps: the organization's projects as HQ names them, each as the
 * overview's headline weighs it (the closed rail's line), and ⌥0, which opens the overview from
 * anywhere. The menu's top row is the Chief (`SidebarChiefRow`); the overview opens from its
 * conversation's header, the Chief page's, the rail and ⌥0.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsEnvironmentServices, ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useEffect, useMemo } from "react";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import type { SidebarCreateProject } from "../sidebar/SidebarChrome";
import {
  overviewKeyPressed,
  overviewProjectOf,
  type OverviewProject,
} from "./SidebarOverview.logic";
import { releaseFailureOf, stopServing } from "./SidebarProductionChip.logic";

/** The organization's projects as HQ's navigation names them, by name. */
export function useMenuProjects(): ReadonlyArray<SidebarCreateProject> {
  const session = useZeropsSession();
  const navigation = useAtomValue(shownCanonicalHqListNavigationAtom);
  const orgId = session.activeOrganization?.id;
  const apps = navigation.orgId === orgId ? navigation.structure?.apps : undefined;
  return useMemo(
    () =>
      (apps ?? [])
        .map(({ id, name }) => ({ id, name }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [apps],
  );
}

/** Each project as the headline weighs it: its stage and production, and its releases. */
export function overviewProjectsOf(input: {
  readonly projects: ReadonlyArray<SidebarCreateProject>;
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  /** The menu's rows: a stage's or a production's, with its services and routes as listed. */
  readonly candidates: ReadonlyArray<
    ZeropsCandidate & {
      readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
      readonly services?: ZeropsEnvironmentServices;
    }
  >;
}): ReadonlyArray<OverviewProject> {
  const byProject = new Map(input.candidates.map((item) => [item.project.id, item]));
  return input.projects.map((project) => {
    const flow = input.flows.get(project.id);
    return overviewProjectOf({
      name: project.name,
      environments: (flow?.environments ?? []).map((environment) => {
        const item =
          environment.target.kind === "zerops"
            ? byProject.get(environment.target.projectId)
            : undefined;
        return {
          tier: environment.tier,
          tone: environment.tone,
          serving:
            item === undefined
              ? "unknown"
              : stopServing({
                  projectStatus: item.project.status,
                  services: item.services?.statuses,
                  routes: item.routes ?? [],
                }).kind,
        };
      }),
      releaseFailed:
        flow !== undefined &&
        flow.releasesKnown &&
        releaseFailureOf({ releases: flow.releases, environmentInputs: flow.environmentInputs }) !==
          undefined,
      releasing: flow?.release.inFlight !== undefined,
    });
  });
}

/** A key typed into a field is the field's. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * ⌥0 opens the overview, whatever the menu shows: the closed rail offers it too (its tip says ⌥0),
 * and it clicks no row hidden under the rail. Off while `onOpen` is undefined.
 */
export function useOverviewKey(onOpen: (() => void) | undefined): void {
  useEffect(() => {
    if (onOpen === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { code, altKey, metaKey, ctrlKey, shiftKey } = event;
      const typing = typedIntoField(event.target);
      if (!overviewKeyPressed({ code, altKey, metaKey, ctrlKey, shiftKey, typing })) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onOpen]);
}
