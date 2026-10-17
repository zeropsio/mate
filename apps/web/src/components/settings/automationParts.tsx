/**
 * The parts Settings › Zerops › HQ's automated Mates and the sources of their tasks share: the room
 * a form takes while its part says something else, the intake's public-repository choice, and a
 * line that copies a value.
 */
import type {
  SettingValue,
  TaskSourceSettingValue,
  TaskSourceWrite,
} from "@t3tools/client-runtime/data";
import { useId, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { sectionState, taskSourceProblem, workingWords } from "./taskSourcesSettings.logic";

/**
 * The room a part's final shape takes (`template`, drawn unseen), held under what it says while it
 * is read, so the part paints in that shape from the first frame and nothing under it moves as
 * what it reads lands.
 */
export function HeldRoom({
  template,
  children,
}: {
  readonly template: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid">
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
        <p
          className="text-xs text-muted-foreground"
          {...(id === undefined ? {} : { id: `${id}-why` })}
        >
          Anyone can write a public repository's issues, and their words reach the agent.
        </p>
      </div>
    </div>
  );
}

export function CopyLine({
  label,
  copy,
  value,
}: {
  readonly label: string;
  /** The press's words: what it copies. */
  readonly copy: string;
  readonly value: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: label });
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{value}</code>
      <Button
        onClick={() => {
          copyToClipboard(value, undefined);
        }}
        size="sm"
        variant="ghost"
      >
        {isCopied ? "Copied" : copy}
      </Button>
    </div>
  );
}

export const WITHHELD = "Only the organization's Owner and Admins see this.";

/**
 * What a part says while its setting is not known — reading, refused, or HQ's failure with *Read
 * again* — in the room its form takes. `quiet`: its section's status line says it already.
 */
export function NotKnown({
  setting,
  onAgain,
  quiet = false,
  template,
}: {
  readonly setting: SettingValue<unknown>;
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
          <p className="text-xs text-muted-foreground" role="alert">
            {setting.words}
          </p>
        )}
        <Button onClick={onAgain} size="sm" variant="secondary">
          Read again
        </Button>
      </div>
    ) : quiet ? null : state === "withheld" ? (
      <p className="text-xs text-muted-foreground">{WITHHELD}</p>
    ) : (
      <p className="text-xs text-muted-foreground">Reading…</p>
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
    <p className="text-xs text-destructive-foreground" role="alert">
      {problem}
    </p>
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
