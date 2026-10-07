/**
 * *Let the crew work on its own* (PRD §4.8): the limits a run works under —
 * how much it may spend and for how long, each an amount or *No limit*, and a
 * stop before the Claude plan's limit — what happens to a finished piece of
 * work, and what the lead and the crewmates may do without asking. It opens
 * from the tab's *Let it work on its own…* and from a plan's Start when no run
 * is on; then (`CrewRunDialogAsk.after`) runs once the run is on — a plan's
 * accept. Its choices start from the last run; the first run has no budget
 * picked (`CrewRunDialog.logic.ts`).
 *
 * *Keep going*: the same dialog after a stop. The limit that stopped the run
 * is set apart and asks for more money or more time, never a new figure.
 */
import {
  CREW_RESUME_TITLE,
  CREW_RUN_LINE,
  CREW_RUN_TITLE,
  CREW_RUN_WORDS,
  crewDevGrantWord,
  crewKeepGoingLine,
  crewResumeBudgetHint,
  crewResumeTimeHint,
  crewResumeUsageHint,
  crewUsageStopWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCommand, CrewRun, CrewSnapshot, EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { useServerConfigs } from "~/state/entities";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";

import { CrewPress } from "./CrewParts";
import {
  crewLandingOptions,
  crewResumeCommand,
  crewResumeDraft,
  crewResumeLimit,
  crewRunDraft,
  crewSpendBlocker,
  crewStartCommand,
  type CrewLimitKind,
  type CrewResumeDraft,
  type CrewRunDraft,
} from "./CrewRunDialog.logic";

/** What opens the dialog: a run to start or to keep going, and what follows once it is on. */
export interface CrewRunDialogAsk {
  readonly mode: "start" | "resume";
  readonly after: CrewCommand | null;
}

export function CrewRunDialog({
  environmentId,
  snapshot,
  hasLead,
  current,
  mateName,
  ask,
  onClose,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  /** The crew as the screen that opens the dialog shows it; `null` keeps it closed. */
  readonly snapshot: CrewSnapshot | null;
  readonly hasLead: boolean;
  /** The snapshot is current: a press acts on what is shown. */
  readonly current: boolean;
  readonly mateName: string;
  /** `null` keeps it closed. */
  readonly ask: CrewRunDialogAsk | null;
  readonly onClose: () => void;
  /** The run is on: what the ask said follows. */
  readonly onDone: (after: CrewCommand | null) => void;
}) {
  const commands = useCrewCommand(environmentId);
  const providers = useServerConfigs().get(environmentId)?.providers;
  const spendBlocker = crewSpendBlocker(
    (snapshot?.crewmates ?? []).map((crewmate) => crewmate.login.id),
    providers,
  );
  const run = snapshot?.run ?? null;
  const resuming = ask?.mode === "resume" && run?.state === "paused" ? run : null;
  const submit = (command: CrewCommand) => {
    void commands.send(command).then((result) => {
      if (result === null) return;
      const after = ask?.after ?? null;
      onClose();
      onDone(after);
    });
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={ask !== null && snapshot !== null}
    >
      <DialogPopup className="max-w-120">
        {snapshot === null || ask === null ? null : resuming === null ? (
          <CrewStartBody
            canAct={current && !commands.pending}
            error={commands.error}
            hasLead={hasLead}
            initial={crewRunDraft(run, hasLead)}
            mateName={mateName}
            spendBlocker={spendBlocker}
            onCancel={onClose}
            onStart={submit}
          />
        ) : (
          <CrewResumeBody
            canAct={current && !commands.pending}
            error={commands.error}
            onCancel={onClose}
            onResume={submit}
            run={resuming}
            spendBlocker={spendBlocker}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** An amount's box as wide as what is typed, so its unit follows it: "8 hours", "90 %". */
const fitted = (text: string) => ({ width: `calc(${Math.max(1, text.length)}ch + 1px)` });

/** An amount, typed, beside its unit — and *No limit* after it. */
function LimitField(props: {
  readonly label: string;
  readonly kind: CrewLimitKind | null;
  readonly text: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly onChange: (kind: CrewLimitKind, text: string) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2">
      <span className="grow text-sm">{props.label}</span>
      <label className="crew-limit" data-off={props.kind === "unlimited" ? "" : undefined}>
        {props.prefix === undefined ? null : (
          <span className="text-muted-foreground">{props.prefix}</span>
        )}
        <input
          aria-label={props.label}
          inputMode="decimal"
          onChange={(event) => props.onChange("amount", event.target.value)}
          onFocus={() => props.onChange("amount", props.text)}
          style={fitted(props.text)}
          value={props.text}
        />
        {props.suffix === undefined ? null : (
          <span className="text-muted-foreground">{props.suffix}</span>
        )}
      </label>
      <button
        aria-pressed={props.kind === "unlimited"}
        className="crew-nolimit"
        onClick={() => props.onChange("unlimited", props.text)}
        type="button"
      >
        {CREW_RUN_WORDS.noLimit}
      </button>
    </div>
  );
}

function Hairline() {
  return <div className="my-4 h-px bg-border" />;
}

function Choice({ children }: { readonly children: ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-2.5">{children}</label>;
}

function Foot({
  error,
  children,
}: {
  readonly error: string | null;
  readonly children: ReactNode;
}) {
  return (
    <>
      {error === null ? null : (
        <p className="px-6 text-line text-status-failed-text" role="alert">
          {error}
        </p>
      )}
      <DialogFooter variant="bare">{children}</DialogFooter>
    </>
  );
}

/** Why the crew can't keep a dollar budget, under the budget's field. */
function SpendBlocker({ words }: { readonly words: string | null }) {
  return words === null ? null : (
    <p className="text-line leading-4.5 text-muted-foreground">{words}</p>
  );
}

export function CrewStartBody(props: {
  readonly initial: CrewRunDraft;
  /** A crewmate's agent doesn't report its spend: only *No limit* starts. */
  readonly spendBlocker: string | null;
  readonly hasLead: boolean;
  readonly mateName: string;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onStart: (command: CrewCommand) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const command = crewStartCommand(draft, props.hasLead, props.spendBlocker !== null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{CREW_RUN_TITLE}</DialogTitle>
        <DialogDescription>{CREW_RUN_LINE}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col" data-crew-run-dialog="start">
          <div className="flex flex-col gap-2">
            <LimitField
              kind={draft.budget}
              label={CREW_RUN_WORDS.spent}
              onChange={(budget, budgetText) => setDraft({ ...draft, budget, budgetText })}
              prefix="$"
              text={draft.budgetText}
            />
            <SpendBlocker words={props.spendBlocker} />
            <LimitField
              kind={draft.time}
              label={CREW_RUN_WORDS.after}
              onChange={(time, timeText) => setDraft({ ...draft, time, timeText })}
              suffix={CREW_RUN_WORDS.hours}
              text={draft.timeText}
            />
            <Choice>
              <Checkbox
                checked={draft.usageStop}
                className="mt-0.5"
                onCheckedChange={(checked) => setDraft({ ...draft, usageStop: checked })}
              />
              <span className="text-sm">{crewUsageStopWord(draft.usagePercent)}</span>
            </Choice>
          </div>
          <Hairline />
          <span className="font-medium text-sm">{CREW_RUN_WORDS.whenDone}</span>
          <div className="mt-2.5">
            <RadioGroup
              aria-label={CREW_RUN_WORDS.whenDone}
              onValueChange={(value) =>
                setDraft({ ...draft, landing: value as CrewRunDraft["landing"] })
              }
              value={draft.landing}
            >
              {crewLandingOptions(props.hasLead, props.mateName).map((option) => (
                <Choice key={option.mode}>
                  <Radio className="mt-0.5" value={option.mode} />
                  <span className="flex flex-col">
                    <span className="text-sm">{option.label}</span>
                    <span className="text-line leading-4.5 text-muted-foreground">
                      {option.line}
                    </span>
                  </span>
                </Choice>
              ))}
            </RadioGroup>
          </div>
          <Hairline />
          <div className="flex flex-col gap-2.5">
            {props.hasLead ? (
              <Choice>
                <Checkbox
                  checked={draft.leadMayStart}
                  className="mt-0.5"
                  onCheckedChange={(checked) => setDraft({ ...draft, leadMayStart: checked })}
                />
                <span className="text-sm">{CREW_RUN_WORDS.leadMayStart}</span>
              </Choice>
            ) : null}
            <Choice>
              <Checkbox
                checked={draft.devGrant}
                className="mt-0.5"
                onCheckedChange={(checked) => setDraft({ ...draft, devGrant: checked })}
              />
              <span className="text-sm">{crewDevGrantWord(props.mateName)}</span>
            </Choice>
          </div>
        </div>
      </DialogPanel>
      <Foot error={props.error}>
        <CrewPress
          label={CREW_RUN_WORDS.cancel}
          onPress={props.onCancel}
          size="view"
          tone="muted"
        />
        <CrewPress
          disabled={!props.canAct || command === null}
          label={CREW_RUN_WORDS.start}
          onPress={() => {
            if (command !== null) props.onStart(command);
          }}
          size="view"
        />
      </Foot>
    </>
  );
}

export function CrewResumeBody(props: {
  readonly run: CrewRun;
  /** A crewmate's agent doesn't report its spend: a dollar budget can't go on. */
  readonly spendBlocker: string | null;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onResume: (command: CrewCommand) => void;
  readonly onCancel: () => void;
}) {
  const { run } = props;
  const [draft, setDraft] = useState<CrewResumeDraft>(() => crewResumeDraft(run));
  const limit = crewResumeLimit(run);
  const command = crewResumeCommand(draft, run);
  const { budgetUsd, timeLimitHours } = run.options;
  const line =
    limit === "budget" && budgetUsd !== "unlimited"
      ? crewResumeBudgetHint(run.spentUsd, budgetUsd)
      : limit === "time" && timeLimitHours !== "unlimited"
        ? crewResumeTimeHint(timeLimitHours)
        : limit === "usage"
          ? crewResumeUsageHint(run.options.stopAtUsagePercent ?? Math.round(run.usagePercent ?? 0))
          : crewKeepGoingLine(run.options);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{CREW_RESUME_TITLE}</DialogTitle>
        <DialogDescription>{line}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-2" data-crew-run-dialog="resume">
          <SpendBlocker words={budgetUsd === "unlimited" ? null : props.spendBlocker} />
          {limit === "budget" ? (
            <LimitField
              kind={draft.more}
              label={CREW_RUN_WORDS.moreMoney}
              onChange={(more, moreText) => setDraft({ ...draft, more, moreText })}
              prefix="$"
              suffix={CREW_RUN_WORDS.more}
              text={draft.moreText}
            />
          ) : null}
          {limit === "time" ? (
            <LimitField
              kind={draft.more}
              label={CREW_RUN_WORDS.moreTime}
              onChange={(more, moreText) => setDraft({ ...draft, more, moreText })}
              suffix={CREW_RUN_WORDS.hoursMore}
              text={draft.moreText}
            />
          ) : null}
          {limit === "usage" ? (
            <Choice>
              <Checkbox
                checked={draft.usageStop}
                className="mt-0.5"
                onCheckedChange={(checked) => setDraft({ ...draft, usageStop: checked })}
              />
              <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {CREW_RUN_WORDS.usageFurther}
                <label className="crew-limit" data-narrow="">
                  <input
                    aria-label={CREW_RUN_WORDS.usageFurther}
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraft({ ...draft, usagePercent: Number(event.target.value) || 0 })
                    }
                    style={fitted(String(draft.usagePercent))}
                    value={String(draft.usagePercent)}
                  />
                </label>
                {CREW_RUN_WORDS.usageOf}
              </span>
            </Choice>
          ) : null}
        </div>
      </DialogPanel>
      <Foot error={props.error}>
        <CrewPress
          label={CREW_RUN_WORDS.cancel}
          onPress={props.onCancel}
          size="view"
          tone="muted"
        />
        <CrewPress
          disabled={!props.canAct || command === null}
          label={CREW_RUN_WORDS.keepGoing}
          onPress={() => {
            if (command !== null) props.onResume(command);
          }}
          size="view"
        />
      </Foot>
    </>
  );
}
