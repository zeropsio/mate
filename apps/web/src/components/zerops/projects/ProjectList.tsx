/**
 * What the overview draws under its cards: the projects without a Mate as lines, each its name and
 * production's line; the containers no project holds as one folded group; and the organization's
 * HQ at the quiet end.
 */

import { Card } from "../../ui/card";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { cn } from "~/lib/utils";
import { useNowMs } from "~/zerops/useNowMs";
import { Button } from "../../ui/button";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { heldLine } from "./emptyApps.logic";
import { GroupName } from "./flowSteps";
import { PlaceDot, PlaceWords } from "./ProjectCards";
import { placeLines } from "./projectCard.logic";
import { containersSummary } from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

/** One project without a Mate: its name, then production's line, its menu on its end. */
function OtherProject<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const nowMs = useNowMs();
  const [line] = placeLines({ flow: entry.flow, ...props.cardPlaces?.(entry), nowMs });
  const held = entry.line ?? heldLine(entry.flow.mates.length, entry.contents);
  return (
    <li
      className="ov-other-row"
      data-zerops-group={entry.group.groupId}
      id={`project-${entry.group.groupId}`}
    >
      <span className="ov-other-name">
        <GroupName entry={entry} />
      </span>
      {held === undefined ? (
        line === undefined ? null : (
          <>
            <PlaceDot dot={line.dot} />
            <PlaceWords line={line} />
          </>
        )
      ) : (
        <span className="ov-place-words">{held}</span>
      )}
      <span className="ov-other-menu">{props.renderGroupMenu(entry)}</span>
    </li>
  );
}

/** The projects without a Mate, under the cards: a line each. */
export function OtherProjects<T>({
  groups,
  props,
}: {
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-label="Other projects" className="ov-other" data-zerops-surface="other-projects">
      <h2 className="ov-other-title">Other projects</h2>
      <ul>
        {groups.map((entry) => (
          <OtherProject entry={entry} key={entry.group.groupId} props={props} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The projects no group holds — containers, and projects without a Mate — as one folded group:
 * its count, a line of their states, the re-probe for the silent ones, and their rows inside.
 */
export function OtherContainers<T>({
  rows,
  props,
}: {
  readonly rows: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const summary = containersSummary(
    rows.map((row) => row.action),
    props.placementNotice,
  );
  const silent = rows.filter((row) => row.action === "retry-probe").map((row) => row.item);
  const mates = rows.filter((row) => props.isMate(row.item));
  const others = rows.filter((row) => !props.isMate(row.item));
  return (
    <Card variant="flat">
      <section className="flex flex-col" data-zerops-surface="other-containers">
        <div className="flex min-h-12 min-w-0 items-center gap-x-3 px-3">
          <button
            aria-expanded={open}
            className="-ms-1 flex shrink-0 items-center gap-1.5 rounded-md ps-1 pe-1.5 text-sm font-semibold text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-200 ease-out",
                open && "rotate-90",
              )}
            />
            <span>
              {props.placementNotice === undefined
                ? "Other containers"
                : "Containers · placement unknown"}{" "}
              <span className="font-normal text-muted-foreground">{rows.length}</span>
            </span>
          </button>
          {/* A narrow container has room for a cut "Not in a…" only: the summary waits for width. */}
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @2xl/flow:block">
            {summary.line}
          </span>
          {summary.retry > 0 ? (
            <Button
              className="ms-auto"
              onClick={() => props.onRetryContainers(silent)}
              size="sm"
              variant="secondary"
            >
              Try again ({summary.retry})
            </Button>
          ) : null}
        </div>
        {open ? (
          <div
            className="flex flex-col gap-2 px-3 pb-3 ps-8"
            data-zerops-surface="other-container-rows"
          >
            {mates.length > 0 ? (
              <div className="grid gap-2 @2xl/flow:grid-cols-2">
                {mates.map(({ item }) => (
                  <Fragment key={props.getKey(item)}>
                    {props.renderMate(item, { layout: "card", parts: [] })}
                  </Fragment>
                ))}
              </div>
            ) : null}
            {others.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border/50">
                {others.map(({ item }) => (
                  <Fragment key={props.getKey(item)}>
                    {props.renderEnvironment(item, undefined)}
                  </Fragment>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
