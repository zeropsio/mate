import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import { cn } from "../../lib/utils";
import type { UsageEnvironmentOwner } from "../../zerops/usageEnvironmentIdentities";
import { Badge } from "../ui/badge";
import { Avatar } from "../zerops/primitives/Avatar";
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

function amount(metric: UsageDimensionMetric, row: { costUsd: number; totalTokens: number }) {
  return metric === "cost" ? formatUsd(row.costUsd) : formatTokens(row.totalTokens);
}

function share(metric: UsageDimensionMetric, row: { costShare: number; tokenShare: number }) {
  return formatPercent(metric === "cost" ? row.costShare : row.tokenShare);
}

export function OwnerName({ owner }: { readonly owner: UsageEnvironmentOwner | null }) {
  if (owner === null) return <span className="truncate text-muted-foreground">Unassigned</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{owner.name}</span>
      {owner.isViewer ? (
        <Badge size="sm" variant="secondary">
          You
        </Badge>
      ) : null}
    </span>
  );
}

export function OwnerAvatar({ owner }: { readonly owner: UsageEnvironmentOwner | null }) {
  return owner === null ? null : (
    <Avatar className="size-4 text-[8px]" initials={owner.initials} src={owner.avatarUrl} />
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
            key={person.owner?.id ?? "unassigned"}
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
            key={person.owner?.id ?? "unassigned"}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: personColor(person, index) }}
              />
              <OwnerAvatar owner={person.owner} />
              <OwnerName owner={person.owner} />
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
  person: "Person",
  project: "Project",
  mate: "Mate",
};

const NO_EXPANDED: ReadonlySet<string> = new Set();

/** A row name that narrows the page to that row when clicked. */
function DrillButton({
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

function MateCells({
  mate,
  metric,
  showOwner,
  indent,
  onScope,
  scope,
}: {
  readonly mate: UsageMateRow;
  readonly metric: UsageDimensionMetric;
  readonly showOwner: boolean;
  readonly indent: boolean;
  readonly onScope: (scope: UsageScope) => void;
  readonly scope: UsageScope;
}) {
  return (
    <tr className="border-b border-border/50 transition-colors hover:bg-muted/50">
      <td className={cn("py-2 text-foreground", indent && "ps-8")}>
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
  scope,
  onScopeChange,
}: {
  readonly dimension: UsageDimension;
  readonly dimensions: UsageDimensions;
  readonly metric: UsageDimensionMetric;
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
          <th className="py-2 text-right font-normal">{metric === "cost" ? "Cost" : "Tokens"}</th>
          <th className="py-2 text-right font-normal">Share</th>
        </tr>
      </thead>
      <tbody>
        {dimension === "person"
          ? dimensions.people.flatMap((person) => {
              const key = person.owner?.id ?? "unassigned";
              const open = expanded.has(key);
              const name = person.owner?.name ?? "Unassigned";
              return [
                <tr key={key} className={rowClass}>
                  <td className="py-2 text-foreground">
                    <span className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} ${name}'s Mates`}
                        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                        onClick={() => toggle(key)}
                      >
                        <ChevronRightIcon
                          aria-hidden
                          className={cn("size-3.5 transition-transform", open && "rotate-90")}
                        />
                      </button>
                      <DrillButton
                        label={`Show ${name}'s usage`}
                        onDrill={
                          person.owner === null
                            ? null
                            : () => onScopeChange({ ...scope, person: person.owner?.id })
                        }
                      >
                        <OwnerAvatar owner={person.owner} />
                        <OwnerName owner={person.owner} />
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
                  ? person.mates.map((mate) => (
                      <MateCells
                        key={`${key}:${mate.environmentId}`}
                        mate={mate}
                        metric={metric}
                        showOwner={false}
                        indent
                        onScope={onScopeChange}
                        scope={scope}
                      />
                    ))
                  : []),
              ];
            })
          : dimension === "project"
            ? dimensions.projects.map((project) => (
                <tr key={project.projectName ?? "unassigned"} className={rowClass}>
                  <td className="py-2 text-foreground">
                    <span className="flex min-w-0 items-center gap-2">
                      <DrillButton
                        label={`Show ${project.projectName ?? "Unassigned"} usage`}
                        onDrill={
                          project.projectName === null
                            ? null
                            : () =>
                                onScopeChange({
                                  ...scope,
                                  project: project.projectName ?? undefined,
                                })
                        }
                      >
                        <span
                          className={cn(
                            "truncate",
                            project.projectName === null && "text-muted-foreground",
                          )}
                        >
                          {project.projectName ?? "Unassigned"}
                        </span>
                      </DrillButton>
                      <span className="flex shrink-0 -space-x-1">
                        {project.owners.map((projectOwner) => (
                          <Avatar
                            key={projectOwner.id}
                            className="size-4 text-[8px] ring-1 ring-background"
                            initials={projectOwner.initials}
                            src={projectOwner.avatarUrl}
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
                </tr>
              ))
            : dimensions.mates.map((mate) => (
                <MateCells
                  key={mate.environmentId}
                  mate={mate}
                  metric={metric}
                  showOwner={dimensions.visible.person}
                  indent={false}
                  onScope={onScopeChange}
                  scope={scope}
                />
              ))}
      </tbody>
    </table>
  );
}
