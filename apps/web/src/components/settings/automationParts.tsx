/**
 * The parts Settings › Automation and the sources of automated Mates' tasks share — here and on a
 * project's page (`projectAutomation/sourceForms`): the room a form takes while its part says
 * something else, the intake's public-repository choice, a line that copies a value, a link to
 * another site, and what a part says while its setting is not known, a write's refusal, a press's
 * words and a labelled field.
 */
import { couldntRead } from "@t3tools/client-runtime/zerops/hq";
import type {
  SettingValue,
  TaskSourceSettingValue,
  TaskSourceWrite,
} from "@t3tools/client-runtime/data";
import { ArrowUpRightIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { CopyLine } from "~/components/ui/copy-line";

import { Button, InlineButton } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { WaitLine } from "../zerops/WaitLine";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { sectionState, taskSourceProblem, workingWords } from "./taskSourcesSettings.logic";
import { Text } from "~/components/ui/text";

/**
 * The room a part's final shape takes (`template`, drawn unseen), held under what it says while it
 * is read, so the part paints in that shape from the first frame and nothing under it moves as
 * what it reads lands.
 */
/** A day as these settings say it: "Nov 7, 2026" in the person's locale. */
export const settingDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function HeldRoom({
  template,
  children,
}: {
  readonly template: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid max-sm:w-full">
      <div aria-hidden className="invisible col-start-1 row-start-1" data-zerops-intake-room="">
        {template}
      </div>
      <div className="col-start-1 row-start-1 self-start">{children}</div>
    </div>
  );
}

/**
 * The room an intake row's form takes, held under whatever the row says instead — reading, taking
 * tasks, nothing to take them from — so the row paints in its final shape from the first frame
 * and never grows as what it reads lands (the cardinal sin).
 */
export function IntakeRoom({
  children,
  choice = false,
}: {
  readonly children: ReactNode;
  /** The intake's form, whose public-repository choice sits under its fields. */
  readonly choice?: boolean;
}) {
  return (
    <div className="grid">
      <div
        aria-hidden
        className="invisible col-start-1 row-start-1 grid gap-2"
        data-zerops-intake-room=""
      >
        <div className="grid gap-1.5">
          <Label>Repository</Label>
          <Input readOnly size="sm" tabIndex={-1} />
        </div>
        {choice ? <PublicChoice checked={false} onChange={() => {}} /> : null}
      </div>
      <div className="col-start-1 row-start-1 self-start">{children}</div>
    </div>
  );
}

/** Whether an intake takes a public repository's issues too, and why it is off unless asked. */
export function PublicChoice({
  id,
  checked,
  onChange,
}: {
  readonly id?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => {
          onChange(next === true);
        }}
        {...(id === undefined ? { tabIndex: -1 } : { id, "aria-describedby": `${id}-why` })}
      />
      <div className="grid gap-0.5">
        <Label {...(id === undefined ? {} : { htmlFor: id })}>
          Take issues from a public repository
        </Label>
        <Text render={<p />} variant="note" {...(id === undefined ? {} : { id: `${id}-why` })}>
          Anyone can write a public repository's issues, and their words reach the agent.
        </Text>
      </div>
    </div>
  );
}

/** A value to copy under its name, the name in a column of its own beside it: a webhook's URL, its secret. */
export function NamedCopyLine({ name, value }: { readonly name: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Text className="w-24 shrink-0" variant="label">
        {name}
      </Text>
      <CopyLine className="flex-1" label={`the ${name.toLowerCase()}`} value={value} />
    </div>
  );
}

/** A link to another site, opened beside Mate: a word that acts, with the arrow that says it leaves. */
export function OutLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <InlineButton render={<a href={href} rel="noreferrer" target="_blank" />}>
      {children}
      <ArrowUpRightIcon aria-hidden="true" className="ms-0.5" />
    </InlineButton>
  );
}

export const WITHHELD = "Only the organization's Owner and Admins see this.";

/**
 * What a part says while its setting is not known — reading, refused, or HQ's failure with *Try
 * again* — in the room its form takes. `quiet`: its section's status line says it already.
 */
export function NotKnown({
  setting,
  what,
  onAgain,
  quiet = false,
  template,
}: {
  readonly setting: SettingValue<unknown>;
  /** What the setting is, as its failure line names it ("the project's webhooks"). */
  readonly what: string;
  readonly onAgain: () => void;
  readonly quiet?: boolean;
  /** The part's final shape, whose room is held; absent: one field's. */
  readonly template?: ReactNode;
}) {
  const state = sectionState(setting);
  const said =
    state === "failed" && setting.state === "failed" ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {quiet ? (
          <span />
        ) : (
          <Text render={<p />} variant="note" role="alert">
            {couldntRead(what, setting.words)}
          </Text>
        )}
        <Button onClick={onAgain} size="sm" variant="secondary">
          Try again
        </Button>
      </div>
    ) : quiet ? null : state === "withheld" ? (
      <Text render={<p />} variant="note">
        {WITHHELD}
      </Text>
    ) : (
      <Text render={<p />} variant="note">
        <WaitLine inline text="Reading…" />
      </Text>
    );
  return template === undefined ? (
    <IntakeRoom>{said}</IntakeRoom>
  ) : (
    <HeldRoom template={template}>{said}</HeldRoom>
  );
}

/** A write's refusal or lost answer, under the part it was made from. */
export function Problem({
  read,
}: {
  readonly read: { readonly action: Parameters<typeof taskSourceProblem>[0] };
}) {
  const problem = taskSourceProblem(read.action);
  return problem === null ? null : (
    <Text render={<p />} variant="error" role="alert">
      {problem}
    </Text>
  );
}

/** A press's words: what it does, or the write it started, while that is under way. */
export function pressWords(
  action: TaskSourceSettingValue<"hqSlack">["action"],
  verbs: ReadonlyArray<TaskSourceWrite["kind"]>,
  words: string,
): string {
  return action.kind === "working" && verbs.includes(action.verb)
    ? workingWords(action.verb)
    : words;
}

export const working = (action: TaskSourceSettingValue<"hqSlack">["action"]) =>
  action.kind === "working";

export function TextField({
  label,
  value,
  onChange,
  describedBy,
  width = "min-w-40 flex-1",
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The line under the form that explains the field. */
  readonly describedBy?: string;
  readonly width?: string;
}) {
  const id = useId();
  return (
    <div className={`grid gap-1.5 ${width}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
        autoComplete="off"
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        size="sm"
        spellCheck={false}
        value={value}
      />
    </div>
  );
}
