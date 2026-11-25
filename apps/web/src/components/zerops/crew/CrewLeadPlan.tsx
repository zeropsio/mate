/**
 * The lead's plan (PRD §4.6, §5.4) — one block, in the lead's row in the
 * Crew tab and above the composer in the lead's chat: the lead's words (in
 * the row; its chat has them already), one line per task — whose it is, what
 * it is, what it waits for — then what Start lets the crew do, said before
 * the button, and *Start* and *Drop the plan*. A line's × leaves that task
 * out. To change the plan, you tell the lead (`CREW_COMPOSER_PLAN_PLACEHOLDER`).
 *
 * Start's commands for the run the crew is in are `crewPlanStart`'s: a
 * paused run goes on first, and the first run asks its limits in the dialog.
 * A viewer who may not run what a press reaches (D6, `crewPlanLocks`) reads
 * the plan without it.
 */
import {
  CREW_PLAN_LINES,
  CREW_PLAN_VERBS,
  crewPlanStartLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewAccess } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewCommand,
  CrewCommandResult,
  CrewRunOptions,
  CrewSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { useZeropsMate } from "~/zerops/useZeropsMates";

import { Failure } from "../../ui/failure";
import { Button } from "../../ui/button";
import { MateFace } from "../primitives";
import {
  crewPlanCard,
  crewPlanCommand,
  crewPlanLocks,
  crewPlanStart,
  type CrewPlanCard,
} from "./CrewLeadPlan.logic";
import { cn } from "~/lib/utils";

import { CrewPress, CrewTextButton, CrewTip } from "./CrewParts";
import { CREW_ORIGIN } from "./CrewRows.logic";
import { CrewRunDialog, type CrewRunDialogAsk } from "./CrewRunDialog";

/** The plan's presses; each `null` where the viewer may not press it (D6). */
interface CrewPlanPresses {
  readonly start: (() => void) | null;
  readonly change: (() => void) | null;
  readonly drop: (() => void) | null;
  /** A line's ×, where that line's drop is the viewer's. */
  readonly leaveOut: (taskId: string) => (() => void) | null;
}

/**
 * What the plan's presses do, for the crew as it stands: Start sends
 * `crewPlanStart`'s commands one after another, or opens the run dialog
 * first with the plan's accept to follow; Change opens the dialog on the
 * limits; Drop the plan and a line's × drop what they name.
 */
export function crewPlanPresses(input: {
  readonly snapshot: CrewSnapshot;
  readonly plan: CrewPlanCard;
  readonly send: (command: CrewCommand, origin: string) => Promise<CrewCommandResult | null>;
  readonly openRunDialog: (ask: CrewRunDialogAsk) => void;
  readonly access: Pick<CrewAccess, "command" | "crew">;
}): CrewPlanPresses {
  const { snapshot, plan, send, openRunDialog } = input;
  const taskIds = plan.rows.map((row) => row.taskId);
  const run = snapshot.run;
  const accept = crewPlanCommand("planAccept", taskIds);
  const running = run?.state === "running" || run?.state === "finishing";
  const locks = crewPlanLocks(run, taskIds, input.access);
  return {
    start:
      locks.start !== null
        ? null
        : () => {
            const start = crewPlanStart(run, taskIds);
            if (start === null) return;
            if (start.kind === "dialog") {
              openRunDialog({ mode: start.dialog, after: start.after });
              return;
            }
            void (async () => {
              for (const command of start.commands) {
                if ((await send(command, CREW_ORIGIN.plan)) === null) return;
              }
            })();
          },
    change:
      running || accept === null || locks.change !== null
        ? null
        : () =>
            openRunDialog({ mode: run?.state === "paused" ? "resume" : "start", after: accept }),
    drop:
      locks.drop !== null
        ? null
        : () => {
            const command = crewPlanCommand("planDiscard", taskIds);
            if (command !== null) void send(command, CREW_ORIGIN.plan);
          },
    leaveOut: (taskId) =>
      locks.leaveOut(taskId) !== null
        ? null
        : () => {
            const command = crewPlanCommand("planDiscard", [taskId]);
            if (command !== null) void send(command, CREW_ORIGIN.plan);
          },
  };
}

/** The plan as it is drawn, in the lead's row and in its chat. */
export function CrewLeadPlanBlock({
  plan,
  words,
  limits,
  presses,
  busy,
  error,
}: {
  readonly plan: CrewPlanCard;
  /** The lead's own words about it; `null` in its chat, which has them already. */
  readonly words: string | null;
  /** The limits Start lets the crew work within: the run's, or the last run's; `null` before a first. */
  readonly limits: CrewRunOptions | null;
  readonly presses: CrewPlanPresses;
  readonly busy: boolean;
  readonly error: string | null;
}) {
  return (
    <div className="flex flex-col" data-crew-plan>
      {words === null ? null : <p className="text-line leading-4.5 text-foreground">{words}</p>}
      {/* The lead's plan: one line per task in a quiet tray, over the row's whole-row press. */}
      <div className="relative z-1 mt-2.5 flex flex-col rounded-card bg-well px-3 py-1 ring-1 ring-foreground/8">
        {plan.rows.map((row) => (
          <div
            // Its face, its owner, what it is, its ×; a hairline between lines.
            className={cn(
              "group/tray-row relative grid grid-cols-[16px_132px_minmax(0,1fr)_20px] gap-x-2 not-first:border-t not-first:border-foreground/8",
              row.after === null
                ? "min-h-8 items-center not-first:min-h-8.25"
                : "items-start py-1.75",
            )}
            key={row.taskId}
          >
            <span className={row.after === null ? "flex" : "flex pt-px"}>
              {row.owner.tint === null ? null : (
                <MateFace size={16} state="idle" tint={row.owner.tint} />
              )}
            </span>
            <span className="truncate font-medium text-line leading-4.5">{row.owner.name}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-line leading-4.5 text-foreground/76">{row.title}</span>
              {row.after === null ? null : (
                <span className="text-line leading-4.5 text-muted-foreground">{row.after}</span>
              )}
            </span>
            <LeaveOut busy={busy} onPress={presses.leaveOut(row.taskId)} title={row.title} />
          </div>
        ))}
      </div>
      {/* What Start lets the crew do is said before it, and only where it is offered. */}
      {presses.start === null ? null : (
        <p className="mt-2.5 text-line leading-4.5 text-muted-foreground">
          {crewPlanStartLine(limits)}
          {presses.change === null ? null : (
            <>
              {" "}
              <CrewTextButton
                label={CREW_PLAN_VERBS.change}
                line={CREW_PLAN_LINES.change}
                onPress={presses.change}
              />
            </>
          )}
        </p>
      )}
      {presses.start === null && presses.drop === null ? null : (
        <div className="mt-2.5 flex items-center gap-1">
          {presses.start === null ? null : (
            <CrewPress disabled={busy} label={CREW_PLAN_VERBS.start} onPress={presses.start} />
          )}
          {presses.drop === null ? null : (
            <CrewPress
              disabled={busy}
              label={CREW_PLAN_VERBS.drop}
              line={CREW_PLAN_LINES.drop}
              onPress={presses.drop}
              variant={presses.start === null ? "primary" : "secondary"}
            />
          )}
        </div>
      )}
      {error === null ? null : (
        <Failure className="mt-1.5" cause={error} role="alert" size="line" />
      )}
    </div>
  );
}

/** A line's ×, in its 20 px column; the column stays where the viewer may not drop the line. */
function LeaveOut({
  title,
  busy,
  onPress,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly onPress: (() => void) | null;
}) {
  if (onPress === null) return <span aria-hidden="true" />;
  return (
    // Shown under the pointer and for the keyboard once it reaches the line.
    <span className="flex opacity-0 transition-opacity duration-150 ease-out-strong group-hover/tray-row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
      <CrewTip tip={CREW_PLAN_VERBS.leaveOut}>
        <Button
          aria-label={`${CREW_PLAN_VERBS.leaveOut}: ${title}`}
          disabled={busy}
          onClick={onPress}
          size="icon-2xs"
          variant="ghost-muted"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </CrewTip>
    </span>
  );
}

/** The lead's plan in its chat, above its composer; nothing while the lead proposes nothing. */
export function CrewLeadPlan({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { snapshot, view, current } = useCrew(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
  const commands = useCrewCommand(environmentId);
  const mate = useZeropsMate(environmentId);
  const [runDialog, setRunDialog] = useState<CrewRunDialogAsk | null>(null);
  if (snapshot === null || view === null) return null;
  const plan = crewPlanCard(snapshot, view as CrewView);
  if (plan === null) return null;
  const presses = crewPlanPresses({
    snapshot,
    plan,
    send: commands.send,
    openRunDialog: setRunDialog,
    access,
  });
  return (
    <div data-crew-lead-plan>
      <CrewLeadPlanBlock
        busy={!current || commands.pending || access.reading}
        error={commands.errorAt(CREW_ORIGIN.plan)}
        limits={snapshot.run?.options ?? null}
        plan={plan}
        presses={presses}
        words={null}
      />
      <CrewRunDialog
        ask={runDialog}
        current={current}
        environmentId={environmentId}
        hasLead={view.lead != null}
        mateName={mate.kind === "mate" ? mate.mate.name : "the Mate"}
        onClose={() => setRunDialog(null)}
        onDone={(after) => {
          if (after !== null) void commands.send(after, CREW_ORIGIN.plan);
        }}
        snapshot={snapshot}
      />
    </div>
  );
}
