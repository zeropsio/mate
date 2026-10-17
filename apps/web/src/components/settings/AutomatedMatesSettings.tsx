/**
 * What automated Mates run on and take tasks from. Settings › Automation's model key — the
 * organization's API key, set, replaced or removed there, never shown back — and, per application
 * (its project's page shows it), the GitHub repository and label its automated Mates take issues
 * from, with what HQ answered as it was set: the webhook it made, or the URL and secret to paste,
 * the secret shown this once.
 */
import type { AppIntakeRead, OrgAiKeysRead } from "@t3tools/client-runtime/data";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import { DEFAULT_INTAKE_LABEL } from "@t3tools/shared/hqIntake";
import type { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { useId, useState } from "react";

import { useAppIntake } from "~/zerops/useAutomationSettings";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { aiKeyLine, intakeAnswerLine, intakeLine } from "./automatedMatesSettings.logic";
import { tasksWaitingWords } from "../zerops/SidebarMateRow.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { CopyLine, IntakeRoom, PublicChoice } from "./automationParts";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** In the settings' place, where this HQ can't do automated Mates. */
export function AutomatedMatesUnsupported() {
  return (
    <p
      className="px-3 pb-3 text-sm text-muted-foreground sm:px-4"
      data-zerops-surface="settings-automated-unsupported"
    >
      Update HQ to set up automated Mates.
    </p>
  );
}

/** The organization's key for one provider: its line and its presses, from what is read. */
export function OrganizationKeyView({
  provider,
  read,
  onSet,
  onRemove,
  onAgain,
}: {
  readonly provider: (typeof OPENCODE_KEY_PROVIDERS)[number];
  readonly read: OrgAiKeysRead;
  readonly onSet: (provider: string, value: string) => void;
  readonly onRemove: (provider: string) => void;
  readonly onAgain: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const keyId = useId();
  const view =
    read.keys.state === "known"
      ? read.keys.keys.find((key) => key.provider === provider.id)
      : undefined;
  const known = read.keys.state === "known";
  const set = view?.set === true;
  const working = read.action.kind === "working";
  const status =
    read.keys.state === "failed"
      ? read.keys.words
      : read.keys.state === "withheld"
        ? "Only the organization's Owner and Admins see its key."
        : !known
          ? "Reading…"
          : working
            ? read.action.kind === "working" && read.action.verb === "remove"
              ? "Removing…"
              : "Saving…"
            : aiKeyLine(view, day);
  const problem =
    read.action.kind === "failed" || read.action.kind === "unresolved" ? read.action.words : null;
  return (
    <SettingsRow
      control={
        editing ? undefined : !known ? (
          read.keys.state === "failed" ? (
            <Button onClick={onAgain} size="sm" variant="secondary">
              Read again
            </Button>
          ) : undefined
        ) : set ? (
          <div className="flex gap-1.5">
            <Button
              disabled={working}
              onClick={() => {
                setEditing(true);
              }}
              size="sm"
              variant="ghost"
            >
              Replace
            </Button>
            <Button
              disabled={working}
              onClick={() => {
                onRemove(provider.id);
              }}
              size="sm"
              variant="ghost"
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button
            disabled={working}
            onClick={() => {
              setEditing(true);
            }}
            size="sm"
            variant="secondary"
          >
            Add key
          </Button>
        )
      }
      data-zerops-surface="settings-org-ai-key"
      description={`Pays for the models automated Mates run: ${provider.models}.`}
      id={searchableSetting("automation-model-key").id}
      status={
        <>
          <span>
            {provider.name} · {status}
          </span>
          {problem === null ? null : <span role="alert"> · {problem}</span>}
        </>
      }
      title="Model key"
    >
      {editing ? (
        <form
          className="grid gap-2 px-3 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = value.trim();
            if (typed.length === 0) return;
            setEditing(false);
            setValue("");
            onSet(provider.id, typed);
          }}
        >
          <Label htmlFor={keyId}>{provider.name} API key</Label>
          <Input
            aria-describedby={`${keyId}-hint`}
            autoComplete="off"
            autoFocus
            id={keyId}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            spellCheck={false}
            type="password"
            value={value}
          />
          {/* The Mates' agents can reach the key: one made for Mate alone, with a limit. */}
          <p className="text-xs text-muted-foreground" id={`${keyId}-hint`}>
            Use a key made only for Mate, with a spending limit. HQ keeps it sealed and never shows
            it again.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setEditing(false);
                setValue("");
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={value.trim().length === 0} size="sm" type="submit">
              Save key
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

/** One application's intake, read while its row is drawn. */
export function AppIntakeRow(props: {
  readonly appId: string;
  readonly name: string;
  readonly choices: ReadonlyArray<string>;
  readonly reposRead: boolean;
  readonly reposFailure: string | undefined;
  readonly onReadAgain: () => void;
}) {
  const { read, set, stop } = useAppIntake(props.appId);
  return <AppIntakeView {...props} onSet={set} onStop={stop} read={read} />;
}

/** One application's intake: where it takes tasks from, or the choice of where, from what is read. */
export function AppIntakeView({
  appId,
  name,
  choices,
  reposRead,
  reposFailure,
  read,
  onSet,
  onStop,
  onReadAgain,
}: {
  readonly appId: string;
  readonly name: string;
  readonly choices: ReadonlyArray<string>;
  readonly reposRead: boolean;
  /** HQ's reason its repositories could not be read: said, with *Read again*. */
  readonly reposFailure?: string | undefined;
  readonly onReadAgain?: (() => void) | undefined;
  readonly read: AppIntakeRead;
  /** `takesPublic`: it takes a public repository's issues too. */
  readonly onSet: (repo: string, label: string, takesPublic: boolean) => void;
  readonly onStop: () => void;
}) {
  const [repo, setRepo] = useState<string | null>(null);
  const [label, setLabel] = useState(DEFAULT_INTAKE_LABEL);
  const [takesPublic, setTakesPublic] = useState(false);
  const labelId = useId();
  const publicId = useId();
  const chosen = repo ?? choices[0] ?? null;
  const working = read.action.kind === "working";
  const problem =
    read.action.kind === "failed" || read.action.kind === "unresolved" ? read.action.words : null;
  return (
    <li className="grid gap-2" data-zerops-intake-app={appId}>
      <p className="text-sm font-medium text-foreground">{name}</p>
      {read.intake === undefined ? (
        <IntakeRoom choice>
          <p className="text-xs text-muted-foreground">Reading…</p>
        </IntakeRoom>
      ) : read.intake !== null ? (
        <IntakeRoom choice>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {[intakeLine(read.intake), tasksWaitingWords(read.intake.waiting)]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </p>
            <Button disabled={working} onClick={onStop} size="sm" variant="ghost">
              Stop taking tasks
            </Button>
          </div>
        </IntakeRoom>
      ) : !reposRead && reposFailure !== undefined ? (
        <IntakeRoom choice>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" role="alert">
              {reposFailure}
            </p>
            {onReadAgain === undefined ? null : (
              <Button onClick={onReadAgain} size="sm" variant="secondary">
                Read again
              </Button>
            )}
          </div>
        </IntakeRoom>
      ) : !reposRead ? (
        <IntakeRoom choice>
          <p className="text-xs text-muted-foreground">Reading its repositories…</p>
        </IntakeRoom>
      ) : chosen === null ? (
        <IntakeRoom choice>
          <p className="text-xs text-muted-foreground">
            Mirror its code to GitHub to take tasks from its issues.
          </p>
        </IntakeRoom>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = label.trim();
            if (typed.length === 0) return;
            onSet(chosen, typed, takesPublic);
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-56 gap-1.5">
              <Label>Repository</Label>
              <Select
                onValueChange={(next) => {
                  if (typeof next === "string") setRepo(next);
                }}
                value={chosen}
              >
                <SelectTrigger aria-label={`${name}'s GitHub repository`} size="sm">
                  <SelectValue>{chosen}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {choices.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {choice}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="grid w-32 gap-1.5">
              <Label htmlFor={labelId}>Label</Label>
              <Input
                id={labelId}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
                size="sm"
                spellCheck={false}
                value={label}
              />
            </div>
            <Button disabled={working || label.trim().length === 0} size="sm" type="submit">
              Take tasks
            </Button>
          </div>
          {/* Off unless asked: anyone can write a public repository's issues. */}
          <PublicChoice checked={takesPublic} id={publicId} onChange={setTakesPublic} />
        </form>
      )}
      {read.answer === null ? null : <IntakeAnswer answer={read.answer} />}
      {problem === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/** HQ's answer as the intake was set: the webhook it made, or the URL and secret to paste. */
function IntakeAnswer({ answer }: { readonly answer: HqIntakeView }) {
  return (
    <div className="grid gap-1.5" data-zerops-surface="settings-intake-answer">
      <p className="text-xs text-foreground">{intakeAnswerLine(answer)}</p>
      {answer.hook.kind === "paste" ? (
        <>
          <CopyLine copy="Copy URL" label="Payload URL" value={answer.webhookUrl} />
          <CopyLine copy="Copy secret" label="Secret" value={answer.hook.secret} />
          <p className="text-xs text-muted-foreground">{answer.hook.why}</p>
        </>
      ) : null}
    </div>
  );
}
