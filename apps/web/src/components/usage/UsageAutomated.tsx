/**
 * Automated work in Usage: the Automated Mates' mark beside people's faces, an automated Mate's
 * tasks under its row, and the month's automated spend against the organization's budget.
 */
import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useAppTaskSource, useOrgTaskSource } from "../../zerops/useTaskSourceSettings";
import { InlineButton } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { automatedBudget, usageMateTasks, type UsageTaskRow } from "./usageAutomated.logic";

/** In place of a face: automated Mates are nobody's own. Decorative: their name stands beside it. */
export function AutomatedMatesMark() {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-background"
    >
      <BotIcon className="size-3" />
    </span>
  );
}

const ROW = "border-b border-border/50";

function TaskTitle({ row }: { readonly row: UsageTaskRow }) {
  const link = "min-w-0 truncate text-primary underline-offset-2 hover:underline";
  const target = row.target;
  if (target === null) return <span className="min-w-0 truncate">{row.title}</span>;
  if (target.kind === "external")
    return (
      <a className={link} href={target.href} rel="noreferrer" target="_blank">
        {row.title}
      </a>
    );
  return target.kind === "mate" ? (
    <Link className={link} params={{ projectId: target.projectId }} to="/mate/$projectId">
      {row.title}
    </Link>
  ) : (
    <Link
      className={link}
      params={{ environmentId: target.environmentId, threadId: target.threadId }}
      to="/$environmentId/$threadId"
    >
      {row.title}
    </Link>
  );
}

/** One line in the task rows' place: what is not a task list yet, at a task row's height. */
function TaskNote({ children }: { readonly children: ReactNode }) {
  return (
    <tr className={ROW}>
      <td className="py-2 ps-14 text-xs text-muted-foreground" colSpan={3}>
        {children}
      </td>
    </tr>
  );
}

/**
 * An automated Mate's tasks in the report's period, under its row: title (to follow it), how it
 * stands, how long it worked, and what it cost, as its Mate reported to HQ.
 */
export function UsageMateTaskRows({
  appId,
  mateProjectId,
  since,
  until,
}: {
  readonly appId: string;
  readonly mateProjectId: string;
  readonly since: string | null;
  readonly until: string;
}) {
  const { read, again } = useAppTaskSource("hqAppTasks", appId);
  const setting = read.setting;
  if (setting.state === "unsupported")
    return <TaskNote>This HQ does not list tasks yet. Update HQ to see each one.</TaskNote>;
  if (setting.state === "failed")
    return (
      <TaskNote>
        Tasks could not be read.{" "}
        <InlineButton onClick={again} tone="muted">
          Try again
        </InlineButton>
      </TaskNote>
    );
  if (setting.state === "withheld") return <TaskNote>Tasks are not shown to you.</TaskNote>;
  if (setting.state !== "known")
    return (
      <tr aria-busy className={ROW}>
        <td className="py-2 ps-14" colSpan={3}>
          <Skeleton className="h-5 w-2/3" />
        </td>
      </tr>
    );
  const rows = usageMateTasks({ tasks: setting.held, mateProjectId, since, until });
  if (rows.length === 0) return <TaskNote>No tasks in this period.</TaskNote>;
  return rows.map((row) => (
    <tr key={row.id} className={cn(ROW, "text-xs")}>
      <td className="py-2 ps-14">
        <span className="flex min-w-0 items-baseline gap-2">
          <TaskTitle row={row} />
          <span className="shrink-0 text-muted-foreground">{row.state}</span>
          <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
            {row.worked ?? "—"}
          </span>
        </span>
      </td>
      <td className="py-2 text-right text-foreground tabular-nums">{row.cost ?? "—"}</td>
      <td />
    </tr>
  ));
}

/** The month's automated spend against the organization's budget; nothing while none is set. */
export function UsageAutomatedBudget() {
  const { read } = useOrgTaskSource("hqTaskLimits");
  const budget = automatedBudget(read.setting.state === "known" ? read.setting.held : null);
  if (budget === null) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <AutomatedMatesMark />
      <span>
        Automated Mates spent{" "}
        <span
          className={cn("tabular-nums", budget.reached ? "text-destructive" : "text-foreground")}
        >
          {budget.spent}
        </span>{" "}
        of this month's <span className="tabular-nums text-foreground">{budget.budget}</span> budget
        {budget.reached ? ": they take no more tasks this month" : ""}.
      </span>
      <Link className="text-primary underline-offset-2 hover:underline" to="/settings/automation">
        Change
      </Link>
    </p>
  );
}
