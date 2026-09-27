/**
 * *Start a run* (PRD §4.8): the limits and options a run of the crew works
 * under. It opens from the Crew section's *Start run* and from a plan's
 * *Start* while no run is on; `onStarted` lets the plan accept its rows once
 * the run is on. Its choices start from the last run; the first run has no
 * budget picked (`CrewRunDialog.logic.ts`).
 */
import type { CrewCommand, EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";

import { Pill } from "../primitives";
import {
  crewLandingOptions,
  crewRunDraft,
  crewStartCommand,
  type CrewLimitKind,
  type CrewRunDraft,
} from "./CrewRunDialog.logic";

export function CrewRunDialog({
  environmentId,
  open,
  onOpenChange,
  onStarted,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Runs once the run has started, e.g. a plan's `planAccept`. */
  readonly onStarted?: () => void;
}) {
  const { snapshot, view, current } = useCrew(environmentId);
  const crewCommand = useCrewCommand(environmentId);
  const hasLead = view?.lead != null;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        {snapshot === null ? null : (
          <CrewRunDialogBody
            initial={crewRunDraft(snapshot.run, hasLead)}
            hasLead={hasLead}
            canAct={current && !crewCommand.pending}
            error={crewCommand.error}
            onStart={(command) => {
              void crewCommand.send(command).then((result) => {
                if (result === null) return;
                onOpenChange(false);
                onStarted?.();
              });
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function Section({ legend, children }: { readonly legend: string; readonly children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Choice({ value, children }: { readonly value: string; readonly children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Radio value={value} />
      {children}
    </label>
  );
}

/** An amount or *No limit*: typing an amount picks it. */
function LimitChoice(props: {
  /** The group's name. */
  readonly label: string;
  /** The amount field's name, with its unit. */
  readonly amountLabel: string;
  readonly kind: CrewLimitKind | null;
  readonly text: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly onChange: (kind: CrewLimitKind, text: string) => void;
}) {
  return (
    <RadioGroup
      aria-label={props.label}
      onValueChange={(value) => props.onChange(value as CrewLimitKind, props.text)}
      value={props.kind}
    >
      <Choice value="amount">
        {props.prefix === undefined ? null : <span>{props.prefix}</span>}
        <Input
          aria-label={props.amountLabel}
          className="w-24"
          inputMode="decimal"
          onChange={(event) => props.onChange("amount", event.target.value)}
          size="sm"
          value={props.text}
        />
        {props.suffix === undefined ? null : <span>{props.suffix}</span>}
      </Choice>
      <Choice value="unlimited">No limit</Choice>
    </RadioGroup>
  );
}

export function CrewRunDialogBody(props: {
  readonly initial: CrewRunDraft;
  readonly hasLead: boolean;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onStart: (command: CrewCommand) => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const command = crewStartCommand(draft, props.hasLead);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Start a run</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-5" data-crew-run-dialog>
          <Section legend="Budget">
            <LimitChoice
              amountLabel="Budget in dollars"
              kind={draft.budget}
              label="Budget"
              onChange={(budget, budgetText) => setDraft({ ...draft, budget, budgetText })}
              prefix="$"
              text={draft.budgetText}
            />
          </Section>
          <Section legend="Time limit">
            <LimitChoice
              amountLabel="Time limit in hours"
              kind={draft.time}
              label="Time limit"
              onChange={(time, timeText) => setDraft({ ...draft, time, timeText })}
              suffix="h"
              text={draft.timeText}
            />
          </Section>
          <Section legend="Usage">
            <Label>
              <Checkbox
                checked={draft.usageStop}
                onCheckedChange={(checked) => setDraft({ ...draft, usageStop: checked })}
              />
              {`Stop at ${draft.usagePercent} % of the usage window`}
            </Label>
          </Section>
          <Section legend="Landing">
            <RadioGroup
              aria-label="Landing"
              onValueChange={(value) =>
                setDraft({ ...draft, landing: value as CrewRunDraft["landing"] })
              }
              value={draft.landing}
            >
              {crewLandingOptions(props.hasLead).map((option) => (
                <Choice key={option.mode} value={option.mode}>
                  {option.label}
                </Choice>
              ))}
            </RadioGroup>
          </Section>
          <Section legend="Dev">
            <RadioGroup
              aria-label="Dev"
              onValueChange={(value) => setDraft({ ...draft, devGrant: value === "grant" })}
              value={draft.devGrant ? "grant" : "ask"}
            >
              <Choice value="ask">Ask me before showing a crewmate&apos;s work on dev</Choice>
              <Choice value="grant">The crew may show work on dev</Choice>
            </RadioGroup>
          </Section>
          {props.hasLead ? (
            <Section legend="The lead">
              <Label>
                <Checkbox
                  checked={draft.leadMayStart}
                  onCheckedChange={(checked) => setDraft({ ...draft, leadMayStart: checked })}
                />
                The lead may start tasks without asking
              </Label>
            </Section>
          ) : null}
          {props.error === null ? null : (
            <p className="text-destructive-foreground text-xs" role="alert">
              {props.error}
            </p>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose
          render={
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          }
        />
        <Pill
          disabled={!props.canAct || command === null}
          label="Start"
          onClick={() => {
            if (command !== null) props.onStart(command);
          }}
          size="sm"
        />
      </DialogFooter>
    </>
  );
}
