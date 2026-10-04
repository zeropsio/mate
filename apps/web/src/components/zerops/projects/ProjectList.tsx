/**
 * The projects page's list: a row per project, at most two lines, then the containers no
 * project holds as one folded group, and the account's tools at the quiet end.
 *
 * A row's first line is the project's name, its Mates by face and full name — two named, the
 * rest a count — and production's version where production runs one. Its second line is the one
 * thing that needs the person, as a full sentence with its single verb at the row's end, else
 * the latest meaningful fact (`projectRowLine`); nothing is said for nothing. A row opens into
 * the project's detail.
 */

import type { GroupFlow } from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { formatElapsedDurationLabel } from "~/timestampFormat";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { FlatCard, MicroLabel, StatusDot } from "../primitives";
import { ENVIRONMENT_ROW_GRID_CLASS } from "../ZeropsEnvironmentRow";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  ComingMateCard,
  drawn,
  GroupName,
  MateChip,
  ComingMateFace,
  matesOf,
  mergesHere,
  QUIET_BUTTON_CLASS,
  releaseVerbFor,
} from "./flowSteps";
import {
  comingMateLine,
  containersSummary,
  productionMark,
  projectRowLine,
  risenFirst,
  rowRises,
  TOOL_LABEL,
  type ProjectRowLine,
} from "./projectsView.logic";
import { lastRowRisen, useRememberRisenRows } from "./rowRiseMemory";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

const rowId = (groupId: string) => `project-${groupId}`;

/** At most this many Mates by name in a row; the rest are a count. */
const MATES_NAMED = 2;

/** The row's Mates: face and full name each, never cut — two of them, then "+1". */
function RowMates<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const mates = matesOf(entry);
  if (mates.length === 0) return null;
  const named = mates.slice(0, MATES_NAMED);
  return (
    <span className="flex shrink-0 items-center gap-x-2.5" data-zerops-step="mates">
      {named.map((chip) =>
        chip.kind === "coming" ? (
          <MateChip
            coming={comingMateLine(chip.coming)}
            face={<ComingMateFace coming={chip.coming} size="sm" />}
            key={`coming:${chip.mate.projectId}`}
            name={chip.mate.name}
            onOpen={undefined}
          />
        ) : (
          <MateChip
            face={props.renderMateFace(chip.item, "sm")}
            key={props.getKey(chip.item)}
            name={chip.mate.name}
            onOpen={props.openMate(chip.item)}
          />
        ),
      )}
      {mates.length > named.length ? (
        <span className="text-xs text-muted-foreground">+{mates.length - named.length}</span>
      ) : null}
    </span>
  );
}

/** When a fact happened, the way the left menu dates its rows: `21h`, `2d`. */
function Age({ at }: { readonly at: string | undefined }) {
  if (at === undefined) return null;
  const age = formatElapsedDurationLabel(at);
  if (age.length === 0) return null;
  return <span className="shrink-0 text-muted-foreground/80 tabular-nums">{age}</span>;
}

/** A line's dot, hung under the row's chevron so the words start under the name. */
function HungDot({ tone }: { readonly tone: ServiceStatusToneId }) {
  return (
    <span aria-hidden="true" className="-ms-5 flex h-5 w-3 shrink-0 items-center justify-center">
      <StatusDot dotOnly label="" tone={tone} />
    </span>
  );
}

/** The row's second line, as `projectRowLine` decided it. */
function RowLine({ line }: { readonly line: ProjectRowLine }) {
  // Lines start at the top: a sentence a phone wraps keeps its dot on its first line.
  const shell = "flex min-h-5 min-w-0 items-start gap-x-2 text-sm leading-5";
  switch (line.kind) {
    case "none":
      return null;
    case "pending":
      return (
        <span aria-busy="true" className={shell} data-zerops-row-line="pending">
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </span>
      );
    case "needs-you":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <HungDot tone={line.tone} />
          {/* The sentence is never cut: on a phone it wraps, and the title it names waits for room. */}
          <span className="min-w-0 text-foreground">{line.text}</span>
          {line.detail === undefined ? null : (
            <span className="hidden min-w-0 flex-1 truncate text-muted-foreground @2xl/flow:block">
              {line.detail}
            </span>
          )}
        </span>
      );
    case "under-way":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <HungDot tone="busy" />
          <span className="min-w-0 text-muted-foreground">{line.text}</span>
        </span>
      );
    case "mate":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <span className="min-w-0 truncate text-muted-foreground">
            <span className="font-medium text-foreground/80">{line.mate}</span>
            <span aria-hidden="true"> · </span>
            {line.text}
          </span>
          <Age at={line.at} />
        </span>
      );
    case "change":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <span className="min-w-0 truncate text-muted-foreground">{line.text}</span>
          {line.detail === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground/80">{line.detail}</span>
          )}
          <Age at={line.at} />
        </span>
      );
    case "first-task":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <span className="min-w-0 text-muted-foreground">{line.text}</span>
        </span>
      );
  }
}

/** Production's version beside the name, where production runs one. */
function ProductionMark({ flow }: { readonly flow: GroupFlow }) {
  const mark = productionMark(flow);
  if (mark === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`Production runs ${mark.version}`}
            className="ms-auto hidden shrink-0 text-xs text-muted-foreground @2xl/flow:flex"
            data-zerops-step="production"
          />
        }
      >
        <StatusDot label={mark.version} sentence tone={mark.tone} />
      </TooltipTrigger>
      <TooltipPopup>Production runs {mark.version}</TooltipPopup>
    </Tooltip>
  );
}

/** What an opened row holds: the Mates' cards, the pull requests, the environments, the releases. */
function RowDetail<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const { flow, group } = entry;
  const mates = matesOf(entry);
  const groupRows = props.renderGroupRows(group);
  const release = releaseVerbFor(entry, props.renderReleaseVerb);
  return (
    <div className="flex flex-col gap-3 px-3 pb-3 ps-8" data-zerops-surface="group-detail">
      {mates.length > 0 ? (
        <div className="grid gap-2 @2xl/flow:grid-cols-2" data-zerops-surface="mate-cards">
          {mates.map((mate) =>
            mate.kind === "coming" ? (
              <ComingMateCard
                coming={mate.coming}
                key={`coming:${mate.mate.projectId}`}
                layout="card"
                name={mate.mate.name}
              />
            ) : (
              <Fragment key={props.getKey(mate.item)}>
                {props.renderMate(mate.item, { layout: "card", preview: undefined })}
              </Fragment>
            ),
          )}
        </div>
      ) : null}
      <ul
        className="flex flex-col divide-y divide-border/50"
        data-zerops-surface="environment-rows"
      >
        {flow.pullRequests.map(({ pull }) => (
          <Fragment key={`${pull.repository}#${String(pull.number)}`}>
            {props.renderPullRequest(group, pull, {
              withMerge: !mergesHere(flow, pull),
              compact: false,
            })}
          </Fragment>
        ))}
        {entry.others.map(({ item, role }) => (
          <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
        ))}
        {[...entry.stops.values()].map(({ item, role }) => (
          <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
        ))}
        {groupRows}
      </ul>
      {drawn(release) ? <span className="flex">{release}</span> : null}
    </div>
  );
}

function ProjectRow<T>({
  entry,
  line,
  props,
  open,
  onToggle,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly line: ProjectRowLine;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { group } = entry;
  const verb = line.kind === "needs-you" ? props.renderNextStep(entry) : null;
  return (
    <li
      className="scroll-mt-4 border-b border-border/40 last:border-b-0"
      data-zerops-group={group.groupId}
      id={rowId(group.groupId)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 @2xl/flow:gap-x-4">
            <button
              aria-expanded={open}
              className="-ms-1 flex min-w-0 items-center gap-1.5 rounded-md ps-1 pe-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              data-zerops-row-toggle="true"
              onClick={onToggle}
              type="button"
            >
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                  open && "rotate-90",
                )}
              />
              <GroupName className="text-sm" entry={entry} />
            </button>
            <RowMates entry={entry} props={props} />
            {entry.line === undefined ? null : (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.line}</span>
            )}
            <ProductionMark flow={entry.flow} />
          </div>
          <div className="ps-5">
            <RowLine line={line} />
          </div>
        </div>
        <span className="flex items-center gap-1.5">
          {/* One width on every row with room, so the versions beside it stand in a column. */}
          <span className="flex justify-end @2xl/flow:w-30" data-zerops-next-step-slot="true">
            {drawn(verb) ? verb : null}
          </span>
          {props.renderGroupMenu(entry)}
        </span>
      </div>
      {open ? <RowDetail entry={entry} props={props} /> : null}
    </li>
  );
}

/**
 * Every project, in the person's order with the rows that need them first. `focusGroup`
 * (`?group=`) opens its row and scrolls it into view, once, when the row is first there.
 */
export function ProjectList<T>({
  groups,
  props,
  focusGroup,
}: {
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly focusGroup: string | undefined;
}) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() =>
    focusGroup === undefined ? new Set() : new Set([focusGroup]),
  );
  const rows = groups.map((entry) => {
    const line = projectRowLine({
      flow: entry.flow,
      lastMerged: entry.lastMerged,
      activities: entry.activities,
      settled: !entry.awaiting && !entry.changesAwaiting,
    });
    return {
      entry,
      line,
      rises: rowRises(line, lastRowRisen(entry.group.groupId)),
      known: line.kind !== "pending",
    };
  });
  useRememberRisenRows(
    rows.map((row) => ({ groupId: row.entry.group.groupId, rises: row.rises, known: row.known })),
  );
  const shown = groups.some((entry) => entry.group.groupId === focusGroup);
  const scrolledTo = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!shown || focusGroup === undefined || scrolledTo.current === focusGroup) return;
    scrolledTo.current = focusGroup;
    setOpenGroups((current) => new Set([...current, focusGroup]));
    document.getElementById(rowId(focusGroup))?.scrollIntoView({ block: "start" });
  }, [focusGroup, shown]);
  if (rows.length === 0) return null;
  const toggle = (groupId: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };
  return (
    <FlatCard>
      <ul aria-label="Projects" data-zerops-surface="project-rows">
        {risenFirst(rows, (row) => row.rises).map(({ entry, line }) => (
          <ProjectRow
            entry={entry}
            key={entry.group.groupId}
            line={line}
            onToggle={() => toggle(entry.group.groupId)}
            open={openGroups.has(entry.group.groupId)}
            props={props}
          />
        ))}
      </ul>
    </FlatCard>
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
  const summary = containersSummary(rows.map((row) => row.action));
  const silent = rows.filter((row) => row.action === "retry-probe").map((row) => row.item);
  const mates = rows.filter((row) => props.isMate(row.item));
  const others = rows.filter((row) => !props.isMate(row.item));
  return (
    <FlatCard>
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
              Other containers{" "}
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
              size="compact"
              variant="outline"
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
                    {props.renderMate(item, { layout: "card", preview: undefined })}
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
    </FlatCard>
  );
}

/** The page's end, quietly: the account's tools. */
export function QuietEnd<T>({ props }: { readonly props: ZeropsProjectsFlowProps<T> }) {
  const offerGitea =
    props.onCreateTool !== undefined && props.tools.every((tool) => tool.kind !== "gitea");
  if (props.tools.length === 0 && !offerGitea) return null;
  return (
    <section data-zerops-surface="quiet-end">
      <ul className="flex flex-col px-3">
        <li className={ENVIRONMENT_ROW_GRID_CLASS} data-zerops-tools="true">
          <MicroLabel className="text-muted-foreground">Tools</MicroLabel>
          <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-3 text-xs sm:col-span-1">
            {props.tools.map(({ item, kind }) => (
              <Fragment key={props.getKey(item)}>{props.renderTool(item, kind)}</Fragment>
            ))}
          </span>
          <span className="col-start-2 row-start-1 flex justify-end sm:col-start-3">
            {offerGitea ? (
              <button
                className={QUIET_BUTTON_CLASS}
                disabled={props.creating}
                onClick={props.onCreateTool}
                type="button"
              >
                <span aria-hidden="true">+</span>
                <span>Add {TOOL_LABEL.gitea}</span>
              </button>
            ) : null}
          </span>
        </li>
      </ul>
    </section>
  );
}
