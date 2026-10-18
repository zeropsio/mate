/**
 * The forms a project's sources of tasks are set with — its GitHub repository and label, its
 * channel on Slack or Discord, its webhooks, its schedules — drawn from what is read of each, in
 * the room its final shape takes. The project page's Automation section opens them; they lived in
 * Settings while sources were set there.
 */
import type {
  AppIntakeRead,
  AppSetting,
  TaskSourceSettingValue,
} from "@t3tools/client-runtime/data";
import type {
  HqChannelView,
  HqIntakeView,
  HqScheduleRequest,
  HqScheduleRule,
  HqScheduleView,
  HqWebhookView,
} from "@t3tools/shared/hqIntake";
import { DEFAULT_INTAKE_LABEL } from "@t3tools/shared/hqIntake";
import { useId, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { TaskSourceControls } from "~/zerops/useTaskSourceSettings";

import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import {
  CopyLine,
  IntakeRoom,
  NotKnown,
  pressWords,
  Problem,
  PublicChoice,
  TextField,
  working,
} from "../../settings/automationParts";
import { intakeAnswerLine, intakeLine } from "../../settings/automatedMatesSettings.logic";
import {
  channelLine,
  scheduleLine,
  scheduleNextLine,
} from "../../settings/taskSourcesSettings.logic";
import { tasksWaitingWords } from "../SidebarMateRow.logic";
import { slackChannelForm } from "./projectAutomation.logic";

type Controls<F extends AppSetting> = TaskSourceControls<F>;

// ── GitHub issues ───────────────────────────────────────────────────────────────────────────

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
  githubApp,
}: {
  readonly appId: string;
  readonly name: string;
  readonly choices: ReadonlyArray<string>;
  /** The organization's GitHub app's name, where it is connected and read. */
  readonly githubApp?: string | undefined;
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
      {read.answer === null ? null : <IntakeAnswer answer={read.answer} githubApp={githubApp} />}
      {problem === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/** HQ's answer as the intake was set: the webhook it made, or the URL and secret to paste. */
function IntakeAnswer({
  answer,
  githubApp,
}: {
  readonly answer: HqIntakeView;
  readonly githubApp: string | undefined;
}) {
  return (
    <div className="grid gap-1.5" data-zerops-surface="settings-intake-answer">
      <p className="text-xs text-foreground">{intakeAnswerLine(answer, githubApp)}</p>
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

// ── an application's channel, on Slack or Discord ───────────────────────────────────────────

export function AppChannelView({
  controls,
  source,
  choices,
}: {
  readonly controls: Controls<"hqAppSlack" | "hqAppDiscord">;
  readonly source: "slack" | "discord";
  /** Slack's: the channels the bot is in, picked from; without them, an ID is typed. */
  readonly choices?: TaskSourceControls<"hqSlackChannels">;
}) {
  const { read, write, again } = controls;
  const [channelId, setChannelId] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const pickerId = useId();
  const setting = read.setting;
  if (setting.state !== "known")
    return (
      <>
        <NotKnown onAgain={again} setting={setting} />
        <Problem read={read} />
      </>
    );
  const held: HqChannelView | null = setting.held.channel;
  const form =
    choices === undefined
      ? ({ kind: "type", invite: null } as const)
      : slackChannelForm(choices.read.setting, typing);
  const busy = working(read.action);
  const take = (id: string) => {
    write({ kind: "channel", source, channelId: id });
  };
  return (
    <>
      {held !== null ? (
        <IntakeRoom>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{channelLine(held)}</p>
            <Button
              disabled={busy}
              onClick={() => {
                write({ kind: "channel-stop", source });
              }}
              size="sm"
              variant="ghost"
            >
              {pressWords(read.action, ["channel-stop"], "Stop")}
            </Button>
          </div>
        </IntakeRoom>
      ) : form.kind === "type" ? (
        <div className="grid gap-2">
          {form.invite === null ? null : (
            <p className="text-xs text-foreground">
              {form.invite} <InlineButton onClick={() => choices?.again()}>Look again</InlineButton>
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const typed = channelId.trim();
              if (typed.length === 0) return;
              take(typed);
            }}
          >
            <TextField
              label="Channel ID, from the channel's details"
              onChange={setChannelId}
              value={channelId}
              width="w-72"
            />
            <Button disabled={busy || channelId.trim().length === 0} size="sm" type="submit">
              {pressWords(read.action, ["channel"], "Take tasks")}
            </Button>
          </form>
          {typing ? (
            <p className="text-xs text-muted-foreground">
              Or{" "}
              <InlineButton onClick={() => setTyping(false)}>
                choose from the bot's channels
              </InlineButton>
              .
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (picked !== null) take(picked);
            }}
          >
            <div className="grid w-72 gap-1.5">
              <Label htmlFor={pickerId}>Channel</Label>
              <Select
                disabled={form.kind === "reading"}
                onValueChange={(next) => {
                  if (typeof next === "string") setPicked(next);
                }}
                value={picked}
              >
                <SelectTrigger aria-label="Slack channel" id={pickerId} size="sm">
                  <SelectValue>
                    {form.kind === "reading"
                      ? "Reading channels…"
                      : (() => {
                          const name = form.channels.find((channel) => channel.id === picked)?.name;
                          return name === undefined ? "Choose a channel" : `#${name}`;
                        })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {form.kind === "pick"
                    ? form.channels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {`#${channel.name}`}
                        </SelectItem>
                      ))
                    : null}
                </SelectPopup>
              </Select>
            </div>
            <Button disabled={busy || picked === null} size="sm" type="submit">
              {pressWords(read.action, ["channel"], "Take tasks")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Not listed? Invite the bot to it, or{" "}
            <InlineButton onClick={() => setTyping(true)}>type its ID</InlineButton>.
          </p>
        </div>
      )}
      <Problem read={read} />
    </>
  );
}

// ── webhooks ────────────────────────────────────────────────────────────────────────────────

export function AppWebhooksView({
  controls,
  name,
}: {
  readonly controls: Controls<"hqAppWebhooks">;
  readonly name: string;
}) {
  const { read, write, again } = controls;
  const [hookName, setHookName] = useState("");
  const setting = read.setting;
  const busy = working(read.action);
  return (
    <>
      {setting.state !== "known" ? (
        <NotKnown onAgain={again} setting={setting} />
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const typed = hookName.trim();
              if (typed.length === 0) return;
              write({ kind: "webhook-make", name: typed });
              setHookName("");
            }}
          >
            <TextField
              label={`${name}'s new webhook`}
              onChange={setHookName}
              value={hookName}
              width="w-56"
            />
            <Button disabled={busy || hookName.trim().length === 0} size="sm" type="submit">
              {pressWords(read.action, ["webhook-make"], "Make webhook")}
            </Button>
          </form>
          {read.revealed === null ? null : <WebhookMade view={read.revealed} />}
          {setting.held.length === 0 ? null : (
            <ul className="grid gap-1.5" data-zerops-surface="settings-webhooks-list">
              {setting.held.map((hook) => (
                <WebhookLine
                  busy={busy}
                  hook={hook}
                  key={hook.id}
                  onDelete={() => {
                    write({ kind: "webhook-delete", webhookId: hook.id });
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <Problem read={read} />
    </>
  );
}

function WebhookMade({ view }: { readonly view: HqWebhookView }) {
  return (
    <div className="grid gap-1.5" data-zerops-surface="settings-webhook-made">
      <p className="text-xs text-foreground">
        {`${view.name} is made. Its secret is shown once: keep it where the caller signs with it.`}
      </p>
      <CopyLine copy="Copy URL" label="URL" value={view.url} />
      {view.secret === undefined ? null : (
        <CopyLine copy="Copy secret" label="Secret" value={view.secret} />
      )}
    </div>
  );
}

function WebhookLine({
  hook,
  busy,
  onDelete,
}: {
  readonly hook: HqWebhookView;
  readonly busy: boolean;
  readonly onDelete: () => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: hook.name });
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-foreground">{hook.name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {hook.url}
      </code>
      <Button
        onClick={() => {
          copyToClipboard(hook.url, undefined);
        }}
        size="sm"
        variant="ghost"
      >
        {isCopied ? "Copied" : "Copy URL"}
      </Button>
      <Button disabled={busy} onClick={onDelete} size="sm" variant="ghost">
        Delete
      </Button>
    </li>
  );
}

// ── schedules ───────────────────────────────────────────────────────────────────────────────

const DAY_CHOICES = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [0, "Sunday"],
] as const;
const EVERY_CHOICES = [
  ["day", "Every day"],
  ["weekday", "Every weekday"],
  ["week", "Every week"],
] as const;

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

const moment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AppSchedulesView({
  controls,
  name,
}: {
  readonly controls: Controls<"hqAppSchedules">;
  readonly name: string;
}) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const busy = working(read.action);
  const make = (request: HqScheduleRequest) => {
    write({ kind: "schedule-make", request });
  };
  return (
    <>
      {setting.state !== "known" ? (
        <NotKnown
          onAgain={again}
          setting={setting}
          template={<ScheduleForm action={{ kind: "idle" }} name={name} onMake={() => {}} />}
        />
      ) : (
        <>
          <ScheduleForm action={read.action} name={name} onMake={make} />
          {setting.held.length === 0 ? null : (
            <ul className="grid gap-1.5" data-zerops-surface="settings-schedules-list">
              {setting.held.map((schedule) => (
                <ScheduleLine
                  busy={busy}
                  key={schedule.id}
                  onDelete={() => {
                    write({ kind: "schedule-delete", scheduleId: schedule.id });
                  }}
                  schedule={schedule}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <Problem read={read} />
    </>
  );
}

/** A new schedule's form: its name, how often and when, in which time zone, and its brief. */
function ScheduleForm({
  name,
  action,
  onMake,
}: {
  readonly name: string;
  readonly action: TaskSourceSettingValue<"hqAppSchedules">["action"];
  readonly onMake: (request: HqScheduleRequest) => void;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [every, setEvery] = useState<HqScheduleRule["every"]>("week");
  const [day, setDay] = useState(1);
  const [at, setAt] = useState("09:00");
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const briefId = useId();
  const busy = working(action);
  const ready =
    title.trim().length > 0 &&
    brief.trim().length > 0 &&
    /^([01]\d|2[0-3]):[0-5]\d$/u.test(at) &&
    timeZone.trim().length > 0;
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onMake({
          name: title.trim(),
          brief: brief.trim(),
          rule: {
            every,
            ...(every === "week" ? { day } : {}),
            at,
            timeZone: timeZone.trim(),
          },
        });
        setTitle("");
        setBrief("");
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          label={`${name}'s new schedule`}
          onChange={setTitle}
          value={title}
          width="w-48"
        />
        <div className="grid w-36 gap-1.5">
          <Label>Repeats</Label>
          <Select
            onValueChange={(next) => {
              if (next === "day" || next === "weekday" || next === "week") setEvery(next);
            }}
            value={every}
          >
            <SelectTrigger aria-label="Repeats" size="sm">
              <SelectValue>{EVERY_CHOICES.find(([value]) => value === every)?.[1]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {EVERY_CHOICES.map(([value, words]) => (
                <SelectItem key={value} value={value}>
                  {words}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {/* Always in its place: choosing how often never moves the fields after it. */}
        <div className="grid w-32 gap-1.5">
          <Label>On</Label>
          <Select
            disabled={every !== "week"}
            onValueChange={(next) => {
              if (typeof next === "number") setDay(next);
            }}
            value={day}
          >
            <SelectTrigger aria-label="On" size="sm">
              <SelectValue>
                {every === "week"
                  ? DAY_CHOICES.find(([value]) => value === day)?.[1]
                  : every === "day"
                    ? "Each day"
                    : "Mon–Fri"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {DAY_CHOICES.map(([value, words]) => (
                <SelectItem key={value} value={value}>
                  {words}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <TimeField onChange={setAt} value={at} />
        <TextField label="Time zone" onChange={setTimeZone} value={timeZone} width="w-40" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={briefId}>Brief</Label>
        <Textarea
          id={briefId}
          onChange={(event) => {
            setBrief(event.target.value);
          }}
          placeholder="Update the dependencies, check the build, and open a change."
          size="sm"
          value={brief}
        />
      </div>
      <div className="flex justify-end">
        <Button disabled={busy || !ready} size="sm" type="submit">
          {pressWords(action, ["schedule-make"], "Add schedule")}
        </Button>
      </div>
    </form>
  );
}

function TimeField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid w-28 gap-1.5">
      <Label htmlFor={id}>At</Label>
      <Input
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        size="sm"
        type="time"
        value={value}
      />
    </div>
  );
}

function ScheduleLine({
  schedule,
  busy,
  onDelete,
}: {
  readonly schedule: HqScheduleView;
  readonly busy: boolean;
  readonly onDelete: () => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <div className="grid min-w-0 flex-1">
        <p className="truncate text-xs text-foreground">{schedule.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {`${scheduleLine(schedule.rule)} · ${scheduleNextLine(schedule.nextAt, moment)}`}
        </p>
      </div>
      <Button disabled={busy} onClick={onDelete} size="sm" variant="ghost">
        Delete
      </Button>
    </li>
  );
}
