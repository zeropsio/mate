/**
 * Automated work in Usage: the Automated Mates' mark beside people's faces, an automated Mate's
 * tasks under its row, and the month's automated spend against the organization's budget.
 */
import type { TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useAppTaskSource, useOrgTaskSource } from "../../zerops/useTaskSourceSettings";
import { InlineButton } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  automatedBudget,
  USAGE_TASKS_CUT_WORDS,
  usageMateTasks,
  usageTaskListCut,
  type UsageTaskRow,
} from "./usageAutomated.logic";

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
/** A task's title starts a step in from its Mate's name, nested under a person or a project or not. */
const taskIndent = (nested: boolean) => (nested ? "ps-20" : "ps-12");

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
function TaskNote({
  nested,
  children,
}: {
  readonly nested: boolean;
  readonly children: ReactNode;
}) {
  return (
    <tr className={ROW}>
      <td className={cn("py-2 text-xs text-muted-foreground", taskIndent(nested))} colSpan={3}>
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
  nested,
  since,
  until,
}: {
  readonly appId: string;
  readonly mateProjectId: string;
  /** Its Mate's row sits under a person's or a project's. */
  readonly nested: boolean;
  readonly since: string | null;
  readonly until: string;
}) {
  const { read, again } = useAppTaskSource("hqAppTasks", appId);
  return (
    <UsageMateTaskRowsView
      again={again}
      mateProjectId={mateProjectId}
      nested={nested}
      setting={read.setting}
      since={since}
      until={until}
    />
  );
}

/** The rows drawn from the application's tasks as read, so a harness can look with no account. */
export function UsageMateTaskRowsView({
  setting,
  again,
  mateProjectId,
  nested,
  since,
  until,
}: {
  readonly setting: TaskSourceSettingValue<"hqAppTasks">["setting"];
  readonly again: () => void;
  readonly mateProjectId: string;
  readonly nested: boolean;
  readonly since: string | null;
  readonly until: string;
}) {
  if (setting.state === "unsupported")
    return (
      <TaskNote nested={nested}>
        This HQ does not list tasks yet. Update HQ to see each one.
      </TaskNote>
    );
  if (setting.state === "failed")
    return (
      <TaskNote nested={nested}>
        Tasks could not be read.{" "}
        <InlineButton onClick={again} tone="muted">
          Try again
        </InlineButton>
      </TaskNote>
    );
  if (setting.state === "withheld")
    return <TaskNote nested={nested}>Tasks are not shown to you.</TaskNote>;
  if (setting.state !== "known")
    return (
      <tr aria-busy className={ROW}>
        <td className={cn("py-2", taskIndent(nested))} colSpan={3}>
          <Skeleton className="h-5 w-2/3" />
        </td>
      </tr>
    );
  const rows = usageMateTasks({ tasks: setting.held, mateProjectId, since, until });
  // HQ lists only an application's newest ended tasks: never "none" where the period is older.
  const cut = usageTaskListCut({ tasks: setting.held, since });
  if (rows.length === 0)
    return (
      <TaskNote nested={nested}>
        {cut ? USAGE_TASKS_CUT_WORDS : "No tasks in this period."}
      </TaskNote>
    );
  const listed = rows.map((row) => (
    <tr key={row.id} className={cn(ROW, "text-xs")}>
      <td className={cn("py-2", taskIndent(nested))}>
        <span className="flex min-w-0 items-baseline gap-2">
          <TaskTitle row={row} />
          <span className="shrink-0 text-muted-foreground">{row.state}</span>
          <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
            {row.worked === null ? "—" : `${row.worked} worked`}
          </span>
        </span>
      </td>
      <td className="py-2 text-right text-foreground tabular-nums">{row.cost ?? "—"}</td>
      <td />
    </tr>
  ));
  return cut ? (
    <>
      {listed}
      <TaskNote nested={nested}>{USAGE_TASKS_CUT_WORDS}</TaskNote>
    </>
  ) : (
    listed
  );
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
