/**
 * Settings › Zerops › HQ, for the organization's Owner and Admins: what automated Mates run on and
 * take tasks from. The organization's API key — set, replaced or removed here, never shown back —
 * and, per application, the GitHub repository and label its automated Mates take issues from, with
 * what HQ answered as it was set: the webhook it made, or the URL and secret to paste, the secret
 * shown this once.
 */
import type { AppIntakeRead, OrgAiKeysRead } from "@t3tools/client-runtime/data";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import { DEFAULT_INTAKE_LABEL } from "@t3tools/shared/hqIntake";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { useAtomValue } from "@effect/atom-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { hqNavigationAtom } from "~/state/zerops";
import { useAccountDataOptional } from "~/zerops/ZeropsAccountData";
import { useHqAppDetailHold, useHqAppReleases } from "~/zerops/useHqAppDetail";
import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppIntake, useOrgAiKeys } from "~/zerops/useAutomationSettings";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  aiKeyLine,
  intakeAnswerLine,
  intakeLine,
  intakeRepoChoices,
} from "./automatedMatesSettings.logic";
import { tasksWaitingWords } from "../zerops/SidebarMateRow.logic";
import { SettingsRow } from "./settingsLayout";

const NEBIUS = OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === "nebius");

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function AutomatedMatesSettings() {
  const { read, setKey, removeKey, again } = useOrgAiKeys(true);
  // An HQ that keeps no organization keys predates automated Mates: one line, nothing to set.
  if (automatedKeyState(read.keys) === "unsupported") return <AutomatedMatesUnsupported />;
  return (
    <>
      {NEBIUS === undefined ? null : (
        <OrganizationKeyView
          onAgain={again}
          onRemove={removeKey}
          onSet={setKey}
          provider={NEBIUS}
          read={read}
        />
      )}
      <TasksFromGithub />
    </>
  );
}

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
              Remove key
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
            Set key
          </Button>
        )
      }
      data-zerops-surface="settings-org-ai-key"
      description={`Automated Mates run OpenCode on it: ${provider.models}. HQ keeps it sealed and never shows it again.`}
      status={
        <>
          <span>{status}</span>
          {problem === null ? null : <span role="alert"> · {problem}</span>}
        </>
      }
      title={`Organization API key — ${provider.name}`}
    >
      {editing ? (
        <form
          className="grid gap-2 px-3 pb-3 sm:px-4"
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
            Use a key made only for Mate, with a spending limit.
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

function TasksFromGithub() {
  const navigation = useAtomValue(hqNavigationAtom);
  // HQ's applications once its navigation is read; until then the row says it is reading.
  const structure = navigation.structure;
  const apps = useMemo(
    () =>
      structure === null ? null : structure.apps.map((app) => ({ id: app.id, name: app.name })),
    [structure],
  );
  return (
    <SettingsRow
      data-zerops-surface="settings-tasks-from-github"
      description="Each application's automated Mates take the issues carrying its label from one of its GitHub repositories, and say on GitHub how each went."
      title="Tasks from GitHub"
    >
      {apps === null ? (
        // An application's row in its shape, until HQ says which there are.
        <ul className="grid gap-3 px-3 pb-3 sm:px-4">
          <li className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Reading…</p>
            <IntakeRoom>{null}</IntakeRoom>
          </li>
        </ul>
      ) : (
        <AppIntakes apps={apps} />
      )}
    </SettingsRow>
  );
}

function AppIntakes({
  apps,
}: {
  readonly apps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const appIds = useMemo(() => apps.map((app) => app.id), [apps]);
  // Each application's repositories, held while the rows are drawn: nothing else may hold them.
  useHqAppDetailHold(appIds);
  const { repos, failures } = useHqAppReleases(appIds);
  const retryDetail = useAccountDataOptional()?.retryDetail;
  return (
    <ul className="grid gap-3 px-3 pb-3 sm:px-4">
      {apps.map((app) => (
        <AppIntakeRow
          appId={app.id}
          choices={intakeRepoChoices(repos.get(app.id))}
          key={app.id}
          name={app.name}
          onReadAgain={() => retryDetail?.({ family: "hqAppDetail", ownerId: app.id })}
          reposFailure={failures.get(app.id)}
          reposRead={repos.has(app.id)}
        />
      ))}
    </ul>
  );
}

function AppIntakeRow(props: {
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
  readonly onSet: (repo: string, label: string) => void;
  readonly onStop: () => void;
}) {
  const [repo, setRepo] = useState<string | null>(null);
  const [label, setLabel] = useState(DEFAULT_INTAKE_LABEL);
  const labelId = useId();
  const chosen = repo ?? choices[0] ?? null;
  const working = read.action.kind === "working";
  const problem =
    read.action.kind === "failed" || read.action.kind === "unresolved" ? read.action.words : null;
  return (
    <li className="grid gap-2" data-zerops-intake-app={appId}>
      <p className="text-sm font-medium text-foreground">{name}</p>
      {read.intake === undefined ? (
        <IntakeRoom>
          <p className="text-xs text-muted-foreground">Reading…</p>
        </IntakeRoom>
      ) : read.intake !== null ? (
        <IntakeRoom>
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
        <IntakeRoom>
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
        <IntakeRoom>
          <p className="text-xs text-muted-foreground">Reading its repositories…</p>
        </IntakeRoom>
      ) : chosen === null ? (
        <IntakeRoom>
          <p className="text-xs text-muted-foreground">
            Mirror its code to GitHub to take tasks from its issues.
          </p>
        </IntakeRoom>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = label.trim();
            if (typed.length === 0) return;
            onSet(chosen, typed);
          }}
        >
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

/**
 * The room an intake row's form takes, held under whatever the row says instead — reading, taking
 * tasks, nothing to take them from — so the row paints in its final shape from the first frame
 * and never grows as what it reads lands (the cardinal sin).
 */
function IntakeRoom({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid">
      <div
        aria-hidden
        className="invisible col-start-1 row-start-1 grid gap-1.5"
        data-zerops-intake-room=""
      >
        <Label>Repository</Label>
        <Input readOnly size="sm" tabIndex={-1} />
      </div>
      <div className="col-start-1 row-start-1 self-center">{children}</div>
    </div>
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

function CopyLine({
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
