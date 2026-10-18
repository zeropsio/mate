import { formatPercent, formatTokens, formatUsageCost } from "@t3tools/shared/usageFormat";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import { cn } from "../../lib/utils";
import {
  isAutomatedMatesOwner,
  type UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { Badge } from "../ui/badge";
import { PersonAvatar } from "../zerops/primitives/PersonAvatar";
import { AutomatedMatesMark, UsageMateTaskRows } from "./UsageAutomated";
import type {
  UsageDimension,
  UsageDimensionMetric,
  UsageDimensions,
  UsageMateRow,
  UsagePersonRow,
  UsageScope,
} from "./usageDimensions";

/**
 * Person series, in legend order: the Mate identity tints, so a person reads
 * in the same family as the faces the left menu draws.
 */
const PERSON_SERIES = [
  "var(--zerops-mate-tint-sky)",
  "var(--zerops-mate-tint-violet)",
  "var(--zerops-mate-tint-amber)",
  "var(--zerops-mate-tint-olive)",
  "var(--zerops-mate-tint-rose)",
  "var(--zerops-mate-tint-coral)",
  "var(--zerops-mate-tint-sand)",
  "var(--zerops-mate-tint-slate)",
] as const;

function personColor(person: UsagePersonRow, index: number): string {
  return person.owner === null
    ? "var(--muted-foreground)"
    : (PERSON_SERIES[index % PERSON_SERIES.length] ?? "var(--muted-foreground)");
}

function amount(
  metric: UsageDimensionMetric,
  row: { costUsd: number; totalTokens: number; costKnown?: boolean; costPartial?: boolean },
) {
  return metric === "cost"
    ? row.costKnown === false
      ? "Unpriced"
      : formatUsageCost(row)
    : formatTokens(row.totalTokens);
}

function share(
  metric: UsageDimensionMetric,
  row: { costShare: number; tokenShare: number; costKnown?: boolean; costPartial?: boolean },
) {
  if (metric === "cost" && row.costKnown === false) return "—";
  return formatPercent(metric === "cost" ? row.costShare : row.tokenShare);
}

export function OwnerName({
  owner,
  state = "unknown",
}: {
  readonly owner: UsageEnvironmentOwner | null;
  readonly state?: UsagePersonRow["ownerState"];
}) {
  if (owner === null)
    return (
      <span className="truncate text-muted-foreground">
        {state === "unassigned" ? "Unassigned" : "Unknown owner"}
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{owner.name}</span>
      {owner.isViewer ? (
        <Badge size="sm" tone="neutral">
          You
        </Badge>
      ) : null}
    </span>
  );
}

export function OwnerAvatar({
  owner,
  title,
}: {
  readonly owner: UsageEnvironmentOwner | null;
  /** Names the face where nothing beside it does. */
  readonly title?: string;
}) {
  if (owner === null) return null;
  return isAutomatedMatesOwner(owner) ? (
    <AutomatedMatesMark />
  ) : (
    <PersonAvatar
      name={owner.name}
      picture={owner.avatarUrl}
      size={16}
      {...(title === undefined ? {} : { title })}
    />
  );
}

/** The report's period, for an automated Mate's tasks. */
export interface UsagePeriod {
  readonly since: string | null;
  readonly until: string;
}

function Disclosure({
  open,
  label,
  onToggle,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
      onClick={onToggle}
    >
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3.5 transition-transform", open && "rotate-90")}
      />
    </button>
  );
}

/** The summary column's split of the total by person, with one legend row each. */
export function UsagePeopleSplit({
  people,
  metric,
}: {
  readonly people: readonly UsagePersonRow[];
  readonly metric: UsageDimensionMetric;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {people.map((person, index) => (
          <span
            key={person.owner?.id ?? person.ownerState}
            className="h-full"
            style={{
              width: `${(metric === "cost" ? person.costShare : person.tokenShare) * 100}%`,
              backgroundColor: personColor(person, index),
            }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {people.map((person, index) => (
          <li
            key={person.owner?.id ?? person.ownerState}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: personColor(person, index) }}
              />
              <OwnerAvatar owner={person.owner} />
              <OwnerName owner={person.owner} state={person.ownerState} />
            </span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="font-medium text-foreground">{amount(metric, person)}</span>
              <span className="text-xs text-muted-foreground">{share(metric, person)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIMENSION_HEADING: Record<UsageDimension, string> = {
  person: "Owner",
  project: "Project",
  mate: "Mate",
};

const NO_EXPANDED: ReadonlySet<string> = new Set();

/** A row name that narrows the page to that row when clicked. */
export function DrillButton({
  label,
  onDrill,
  children,
}: {
  readonly label: string;
  readonly onDrill: (() => void) | null;
  readonly children: React.ReactNode;
}) {
  if (onDrill === null) return <span className="flex min-w-0 items-center gap-2">{children}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      className="flex min-w-0 items-center gap-2 rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onDrill}
    >
      {children}
    </button>
  );
}

/** An automated Mate's row opens into its tasks; a Mate's row is the same otherwise. */
function taskSource(mate: UsageMateRow): { appId: string; mateProjectId: string } | null {
  return isAutomatedMatesOwner(mate.owner) &&
    mate.projectId !== null &&
    mate.mateProjectId !== undefined
    ? { appId: mate.projectId, mateProjectId: mate.mateProjectId }
    : null;
}

function MateCells({
  mate,
  metric,
  showOwner,
  indent,
  disclosureRoom,
  open,
  onToggle,
  onScope,
  scope,
}: {
  readonly mate: UsageMateRow;
  readonly metric: UsageDimensionMetric;
  readonly showOwner: boolean;
  readonly indent: boolean;
  /** Its siblings open: a row that does not keeps their names aligned. */
  readonly disclosureRoom: boolean;
  readonly open: boolean;
  readonly onToggle: (() => void) | null;
  readonly onScope: (scope: UsageScope) => void;
  readonly scope: UsageScope;
}) {
  return (
    <tr className="border-b border-border/50 transition-colors hover:bg-muted/50">
      <td className={cn("py-2 text-foreground", indent && "ps-8")}>
        <span className="flex min-w-0 items-center gap-1">
          {onToggle !== null ? (
            <Disclosure
              open={open}
              label={`${open ? "Hide" : "Show"} ${mate.mateName}'s tasks`}
              onToggle={onToggle}
            />
          ) : disclosureRoom ? (
            <span aria-hidden className="size-5 shrink-0" />
          ) : null}
          <DrillButton
            label={`Show ${mate.mateName}'s usage`}
            onDrill={() => onScope({ ...scope, mate: mate.environmentId })}
          >
            {showOwner ? <OwnerAvatar owner={mate.owner} /> : null}
            <span className="truncate">
              {mate.mateName}
              {mate.projectName === null ? null : (
                <span className="text-muted-foreground"> · {mate.projectName}</span>
              )}
            </span>
          </DrillButton>
        </span>
      </td>
      <td className="py-2 text-right text-foreground tabular-nums">{amount(metric, mate)}</td>
      <td className="py-2 text-right text-muted-foreground tabular-nums">{share(metric, mate)}</td>
    </tr>
  );
}

/** The Breakdown table for one of the who-dimensions: Person, Project or Mate. */
export function UsageDimensionTable({
  dimension,
  dimensions,
  metric,
  period,
  scope,
  onScopeChange,
}: {
  readonly dimension: UsageDimension;
  readonly dimensions: UsageDimensions;
  readonly metric: UsageDimensionMetric;
  /** The report's period; null while none is read: an automated Mate's tasks wait for it. */
  readonly period: UsagePeriod | null;
  readonly scope: UsageScope;
  readonly onScopeChange: (scope: UsageScope) => void;
}) {
  const [expanded, setExpanded] = useState(NO_EXPANDED);
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };
  const rowClass = "border-b border-border/50 transition-colors hover:bg-muted/50";

  /** A Mate's row, and its tasks under it while open. */
  const mateRows = (
    mate: UsageMateRow,
    key: string,
    nested: boolean,
    room: boolean,
    showOwner: boolean,
  ) => {
    const source = period === null ? null : taskSource(mate);
    const open = source !== null && expanded.has(key);
    return [
      <MateCells
        key={key}
        mate={mate}
        metric={metric}
        showOwner={showOwner}
        indent={nested}
        disclosureRoom={room}
        open={open}
        onToggle={source === null ? null : () => toggle(key)}
        onScope={onScopeChange}
        scope={scope}
      />,
      ...(open && source !== null && period !== null
        ? [
            <UsageMateTaskRows
              key={`${key}:tasks`}
              appId={source.appId}
              mateProjectId={source.mateProjectId}
              since={period.since}
              until={period.until}
            />,
          ]
        : []),
    ];
  };
  const opensAny = (mates: readonly UsageMateRow[]) =>
    period !== null && mates.some((mate) => taskSource(mate) !== null);

  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-3/5" />
        <col className="w-1/5" />
        <col className="w-1/5" />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="py-2 font-normal">{DIMENSION_HEADING[dimension]}</th>
          <th className="py-2 text-right font-normal">
            {metric === "cost" ? "Priced cost" : "Tokens"}
          </th>
          <th className="py-2 text-right font-normal">Share</th>
        </tr>
      </thead>
      <tbody>
        {dimension === "person"
          ? dimensions.people.flatMap((person) => {
              const key = person.owner?.id ?? person.ownerState;
              const open = expanded.has(key);
              const name =
                person.owner?.name ??
                (person.ownerState === "unassigned" ? "Unassigned" : "Unknown owner");
              const room = opensAny(person.mates);
              return [
                <tr key={key} className={rowClass}>
                  <td className="py-2 text-foreground">
                    <span className="flex min-w-0 items-center gap-1">
                      <Disclosure
                        open={open}
                        label={`${open ? "Hide" : "Show"} ${name}'s Mates`}
                        onToggle={() => toggle(key)}
                      />
                      <DrillButton
                        label={`Show ${name}'s usage`}
                        onDrill={
                          person.owner === null
                            ? null
                            : () => onScopeChange({ ...scope, person: person.owner?.id })
                        }
                      >
                        <OwnerAvatar owner={person.owner} />
                        <OwnerName owner={person.owner} state={person.ownerState} />
                      </DrillButton>
                    </span>
                  </td>
                  <td className="py-2 text-right text-foreground tabular-nums">
                    {amount(metric, person)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {share(metric, person)}
                  </td>
                </tr>,
                ...(open
                  ? person.mates.flatMap((mate) =>
                      mateRows(mate, `${key}:${mate.environmentId}`, true, room, false),
                    )
                  : []),
              ];
            })
          : dimension === "project"
            ? dimensions.projects.flatMap((project) => {
                const key = `project:${project.projectId ?? "unknown"}`;
                const open = expanded.has(key);
                const name = project.projectName ?? "Unknown project";
                const room = opensAny(project.mates);
                return [
                  <tr key={key} className={rowClass}>
                    <td className="py-2 text-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <Disclosure
                          open={open}
                          label={`${open ? "Hide" : "Show"} ${name}'s Mates`}
                          onToggle={() => toggle(key)}
                        />
                        <DrillButton
                          label={`Show ${name} usage`}
                          onDrill={
                            project.projectId === null
                              ? null
                              : () =>
                                  onScopeChange({
                                    ...scope,
                                    project: project.projectId ?? undefined,
                                  })
                          }
                        >
                          <span
                            className={cn(
                              "truncate",
                              project.projectName === null && "text-muted-foreground",
                            )}
                          >
                            {name}
                          </span>
                        </DrillButton>
                        <span className="ms-1 flex shrink-0 -space-x-1">
                          {project.owners.map((projectOwner) => (
                            <OwnerAvatar
                              key={projectOwner.id}
                              owner={projectOwner}
                              title={projectOwner.name}
                            />
                          ))}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 text-right text-foreground tabular-nums">
                      {amount(metric, project)}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {share(metric, project)}
                    </td>
                  </tr>,
                  ...(open
                    ? project.mates.flatMap((mate) =>
                        mateRows(
                          mate,
                          `${key}:${mate.environmentId}`,
                          true,
                          room,
                          dimensions.visible.person,
                        ),
                      )
                    : []),
                ];
              })
            : dimensions.mates.flatMap((mate) =>
                mateRows(
                  mate,
                  mate.environmentId,
                  false,
                  opensAny(dimensions.mates),
                  dimensions.visible.person,
                ),
              )}
      </tbody>
    </table>
  );
}
