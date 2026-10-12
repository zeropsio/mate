/**
 * The Overview row, first in the menu's list: a soft disc with the layers glyph, "Overview", and
 * the organization in one line (`overviewHeadline`) — or, while something waits on the person,
 * what waits in a few plain words (`waitingSummary`), its count in an amber disc at the row's end
 * that opens the list of it beside the menu (the owner, 2026-10-12, of a Waiting on you row of its
 * own: "waiting on you is use less, it should be included in the overview somehow"). It wears the
 * selected band while the overview is open; a click and ⌥0 open it.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsEnvironmentServices, ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { LayersIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { MateMark } from "../MateMark";

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
import { SidebarWaitingPopover, type WaitingVerbs } from "./SidebarWaiting";
import { waitingSummary, type WaitingItem } from "./SidebarWaiting.logic";

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
  waiting,
  mastermate = false,
}: {
  /**
   * The organization's Mastermate stands in for the overview (prototype): the menu's top row,
   * the Mate's own mark and its name, opening its conversation, whose panel holds the overview.
   */
  readonly mastermate?: boolean;
  /** The organization in one line (`overviewHeadline`). */
  readonly headline: string;
  /** The overview is the page open now. */
  readonly current: boolean;
  readonly onOpen: () => void;
  /** What waits on the person, and what its list asks of the menu. */
  readonly waiting?:
    | { readonly items: ReadonlyArray<WaitingItem>; readonly verbs: WaitingVerbs }
    | undefined;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { code, altKey, metaKey, ctrlKey, shiftKey } = event;
      const typing = typedIntoField(event.target);
      if (!overviewKeyPressed({ code, altKey, metaKey, ctrlKey, shiftKey, typing })) return;
      // It opens the overview, whatever the menu shows: the closed rail offers it too (its tip
      // says ⌥0), and it clicks no row hidden under the rail.
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onOpen]);
  const items = waiting?.items ?? [];
  const summary = items.length === 0 ? undefined : waitingSummary(items);
  return (
    <div className="menu-overview" data-master={mastermate ? "" : undefined}>
      <button
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts="Alt+0"
        className="menu-chrome-row"
        data-current={current ? "" : undefined}
        data-waits={summary === undefined ? undefined : ""}
        data-zerops-surface="sidebar-overview"
        onClick={onOpen}
        type="button"
      >
        <span className="menu-chrome-disc" aria-hidden="true">
          {mastermate ? (
            <MateMark awake playful className="h-9 w-7.5" />
          ) : (
            <LayersIcon className="size-4.5" />
          )}
        </span>
        <span className="menu-chrome-text">
          <span className="menu-chrome-name" data-waiting-line="">
            {mastermate ? "Mastermate" : "Overview"}
          </span>
          {summary === undefined ? (
            <span className="menu-chrome-line" data-zerops-surface="sidebar-overview-headline">
              <span>{headline}</span>
            </span>
          ) : (
            <span
              className="menu-chrome-line"
              data-ink=""
              data-zerops-surface="sidebar-waiting-line"
            >
              <span>{summary.words}</span>
              {summary.more > 0 ? <span>· {summary.more} more</span> : null}
            </span>
          )}
        </span>
      </button>
      {waiting === undefined || summary === undefined ? null : (
        <SidebarWaitingPopover
          items={items}
          trigger={
            <button
              aria-label={`${String(items.length)} waiting on you: ${summary.words}${summary.more > 0 ? `, ${String(summary.more)} more` : ""}`}
              className="menu-chrome-count"
              data-waiting-trigger=""
              data-zerops-surface="sidebar-waiting"
              type="button"
            />
          }
          verbs={waiting.verbs}
        >
          <span data-zerops-surface="sidebar-waiting-count">{items.length}</span>
        </SidebarWaitingPopover>
      )}
    </div>
  );
}
