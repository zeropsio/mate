/**
 * The projects page's list: a row per project, at most two lines, then the containers no
 * project holds as one folded group, and the organization's HQ at the quiet end.
 *
 * A row's first line is the project's name, its Mates by face and full name — two named, the
 * rest a count — what HQ still holds of it (`heldLine`), and production's version where
 * production runs one; a stop whose read failed says so there, with its one attempt. Its second
 * line is the one
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
import { FlatCard, StatusDot } from "../primitives";
import { StopReadAgain } from "../StopReadAgain";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { heldLine } from "./emptyApps.logic";
import {
  ComingMateCard,
  drawn,
  GroupName,
  MateChip,
  ComingMateFace,
  matesOf,
  mergesHere,
  releaseVerbFor,
} from "./flowSteps";
import {
  comingMateLine,
  containersSummary,
  productionMark,
  projectRowLine,
  risenFirst,
  stopLine,
  type ProjectRowLine,
} from "./projectsView.logic";
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
          <Age at={line.at} />
        </span>
      );
    case "unread":
      return (
        <span className={shell} data-zerops-row-line={line.kind}>
          <HungDot tone="off" />
          <span className="min-w-0 text-muted-foreground">{line.text}</span>
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
            className="hidden shrink-0 text-xs text-muted-foreground @2xl/flow:flex"
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

/**
 * The row's stops — its production, then its stages — at the first line's end: production's
 * version, and a stop whose read failed by its name and what it says, beside its one attempt
 * (`StopReadAgain`). Every stop is drawn here, row opened or not, so each holds the demand that
 * reads what it runs: production's version and a failed deploy come from that read.
 */
function RowStops({ flow }: { readonly flow: GroupFlow }) {
  const { production } = flow;
  const stops = [
    ...(production.kind === "absent" || production.kind === "creating" ? [] : [production.stop]),
    ...flow.stages,
  ];
  return (
    <span className="ms-auto flex min-w-0 items-center gap-x-3 text-xs text-muted-foreground">
      {stops.map((stop) => (
        <span
          className="flex min-w-0 items-center gap-x-1.5 empty:hidden"
          data-zerops-row-stop={stop.projectId}
          key={stop.projectId}
        >
          {stop.readFailed === true ? (
            <span className="min-w-0 truncate">
              {stop.name} · {stopLine(stop).word}
            </span>
          ) : null}
          <StopReadAgain projectId={stop.projectId} />
        </span>
      ))}
      <ProductionMark flow={flow} />
    </span>
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
        {flow.pullRequests.map(({ pull, review }) => (
          <Fragment key={`${pull.repository}#${String(pull.number)}`}>
            {props.renderPullRequest(group, pull, {
              withMerge: !mergesHere(flow, pull),
              review,
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
            {[entry.line, heldLine(entry.flow.mates.length, entry.contents)].map((meta) =>
              meta === undefined ? null : (
                <span className="min-w-0 truncate text-xs text-muted-foreground" key={meta}>
                  {meta}
                </span>
              ),
            )}
            <RowStops flow={entry.flow} />
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
      changesUnknown: entry.changesUnknown,
    });
    return { entry, line };
  });
  const shown = groups.some((entry) => entry.group.groupId === focusGroup);
  // A row that needs the person rises, as soon as its answers say so.
  const ordered = risenFirst(rows, (row) => row.line.kind === "needs-you");
  const orderKey = ordered.map((row) => row.entry.group.groupId).join(",");
  const scrolledTo = useRef<string | undefined>(undefined);
  // The named row stays in view while rows above it rise as their reads answer — until the
  // person scrolls or types for themselves.
  const following = useRef(true);
  useEffect(() => {
    if (focusGroup === undefined) return;
    following.current = true;
    const stop = () => {
      following.current = false;
    };
    const intents = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const intent of intents) window.addEventListener(intent, stop, { passive: true });
    return () => {
      for (const intent of intents) window.removeEventListener(intent, stop);
    };
  }, [focusGroup]);
  useEffect(() => {
    // Run again whenever the order moves (`orderKey`): the row may have been pushed down.
    if (!shown || focusGroup === undefined || orderKey.length === 0) return;
    if (scrolledTo.current !== focusGroup) {
      scrolledTo.current = focusGroup;
      setOpenGroups((current) => new Set([...current, focusGroup]));
    } else if (!following.current) return;
    document.getElementById(rowId(focusGroup))?.scrollIntoView({ block: "start" });
  }, [focusGroup, shown, orderKey]);
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
        {ordered.map(({ entry, line }) => (
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

/** The page's end, quietly: the organization's HQ. */
export function QuietEnd<T>({ props }: { readonly props: ZeropsProjectsFlowProps<T> }) {
  return <section data-zerops-surface="quiet-end">{props.hqCard}</section>;
}
