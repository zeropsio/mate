/**
 * The Overview row, first in the menu's list: a soft disc with the layers glyph, "Overview", and
 * the organization in one line (`overviewHeadline`). It wears the selected band while the overview
 * is open; a click and ⌥0 open it.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsEnvironmentServices, ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { LayersIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { hqNavigationAtom } from "~/state/zerops";
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
  const navigation = useAtomValue(hqNavigationAtom);
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
        const item = byProject.get(environment.projectId);
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

export function SidebarOverviewRow({
  headline,
  current,
  onOpen,
}: {
  /** The organization in one line (`overviewHeadline`). */
  readonly headline: string;
  /** The overview is the page open now. */
  readonly current: boolean;
  readonly onOpen: () => void;
}) {
  useEffect(() => {
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
  return (
    <button
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts="Alt+0"
      className="menu-chrome-row"
      data-current={current ? "" : undefined}
      data-zerops-surface="sidebar-overview"
      onClick={onOpen}
      type="button"
    >
      <span className="menu-chrome-disc" aria-hidden="true">
        <LayersIcon className="size-4.5" />
      </span>
      <span className="menu-chrome-text">
        <span className="menu-chrome-name">Overview</span>
        <span className="menu-chrome-line" data-zerops-surface="sidebar-overview-headline">
          <span>{headline}</span>
        </span>
      </span>
    </button>
  );
}
