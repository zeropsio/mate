/**
 * Settings › Zerops › HQ, below Tasks from GitHub, for the organization's Owner and Admins: where
 * automated Mates take tasks from besides GitHub. The organization's Slack app — made from the
 * manifest HQ gives, its tokens pasted here and never shown back — and its Discord application
 * with who may use it; per application, the channel it takes tasks from on each, its signed
 * webhooks (the secret shown once, as it is made) and its schedules; and the limits on each task.
 * An HQ older than these says so in one line, and none of them is drawn.
 *
 * Each part paints in its final shape while it is read (`IntakeRoom`): nothing it reads moves what
 * the person is about to press.
 */
import type { AppSetting, OrgSetting, SettingValue } from "@t3tools/client-runtime/data";
import type { HqDiscordView, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { useAtomValue } from "@effect/atom-react";
import { ArrowUpRightIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { hqNavigationAtom } from "~/state/zerops";
import {
  useAppTaskSource,
  useOrgTaskSource,
  type TaskSourceControls,
} from "~/zerops/useTaskSourceSettings";

import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  CopyLine,
  IntakeRoom,
  NotKnown,
  pressWords,
  Problem,
  TextField,
  WITHHELD,
  working,
} from "./automationParts";
import {
  AppChannelView,
  AppSchedulesView,
  AppWebhooksView,
} from "../zerops/projectAutomation/sourceForms";

// Moved to the project page's Automation section; kept importable from here.
export { AppChannelView, AppSchedulesView, AppWebhooksView };
import { SettingsRow } from "./settingsLayout";
import {
  allowlistAfter,
  limitsLine,
  readLimits,
  slackLine,
  taskSourcesUnsupported,
} from "./taskSourcesSettings.logic";

/** Controls over nothing, for a part drawn unseen as the room its final shape takes. */
const UNSEEN = {
  read: { setting: { state: "unread" }, action: { kind: "idle" }, revealed: null },
  write: () => {},
  again: () => {},
} as TaskSourceControls<never>;
/** How HQ answers an organization with no Discord application: no address until connected. */
const DISCORD_OFF: HqDiscordView = {
  connected: false,
  interactionsUrl: "",
  inviteUrl: null,
  allowed: [],
};

const SLACK_NEW_APP = "https://api.slack.com/apps?new_app=1";
const DISCORD_PORTAL = "https://discord.com/developers/applications";

type Controls<F extends OrgSetting | AppSetting> = TaskSourceControls<F>;

interface App {
  readonly id: string;
  readonly name: string;
}

export function TaskSourcesSettings() {
  const limits = useOrgTaskSource("hqTaskLimits");
  const slack = useOrgTaskSource("hqSlack");
  const discord = useOrgTaskSource("hqDiscord");
  const navigation = useAtomValue(hqNavigationAtom);
  const structure = navigation.structure;
  const apps = useMemo(
    () =>
      structure === null ? null : structure.apps.map((app) => ({ id: app.id, name: app.name })),
    [structure],
  );
  if (taskSourcesUnsupported([limits.read.setting, slack.read.setting, discord.read.setting]))
    return <TaskSourcesUnsupported />;
  return (
    <>
      <SlackSettingsView apps={apps} controls={slack} />
      <DiscordSettingsView apps={apps} controls={discord} />
      <WebhooksSettings apps={apps} />
      <SchedulesSettings apps={apps} />
      <TaskLimitsView controls={limits} />
    </>
  );
}

/** In these settings' place, where this HQ predates them. */
export function TaskSourcesUnsupported() {
  return (
    <p
      className="px-3 pb-3 text-sm text-muted-foreground sm:px-4"
      data-zerops-surface="settings-task-sources-unsupported"
    >
      Update HQ to take tasks from Slack, Discord, webhooks and schedules.
    </p>
  );
}

// ── the parts every section shares ──────────────────────────────────────────────────────────

/**
 * What a section's status line says of its setting: its own line once known, else that it is
 * read, refused or failed — there from the first frame, so the line never appears under it.
 */
function statusOf<T>(setting: SettingValue<T>, line: (value: T) => string): string {
  switch (setting.state) {
    case "known":
      return line(setting.held);
    case "failed":
      return setting.words;
    case "withheld":
      return WITHHELD;
    default:
      return "Reading…";
  }
}

function Step({ n, children }: { readonly n: number; readonly children: ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-foreground">
      <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{n}.</span>
      <div className="grid min-w-0 flex-1 gap-1.5">{children}</div>
    </li>
  );
}

function OutLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <InlineButton render={<a href={href} rel="noreferrer" target="_blank" />}>
      {children}
      <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
    </InlineButton>
  );
}

function SecretField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid min-w-56 flex-1 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete="off"
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        size="sm"
        spellCheck={false}
        type="password"
        value={value}
      />
    </div>
  );
}

/** Each application's row of a section, once HQ says which there are. */
function AppRows({
  apps,
  children,
}: {
  readonly apps: ReadonlyArray<App> | null;
  readonly children: (app: App) => ReactNode;
}) {
  return (
    <ul className="grid gap-3">
      {apps === null ? (
        <li className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">Reading…</p>
          <IntakeRoom>{null}</IntakeRoom>
        </li>
      ) : (
        apps.map((app) => (
          <li className="grid gap-2" data-zerops-task-source-app={app.id} key={app.id}>
            <p className="text-sm font-medium text-foreground">{app.name}</p>
            {children(app)}
          </li>
        ))
      )}
    </ul>
  );
}

// ── Slack ───────────────────────────────────────────────────────────────────────────────────

export function SlackSettingsView({
  controls,
  apps,
  manifest,
  channel,
}: {
  readonly controls: Controls<"hqSlack">;
  readonly apps: ReadonlyArray<App> | null;
  /** The manifest's read, where the harness hands it; else read while the steps show. */
  readonly manifest?: Controls<"hqSlackManifest">;
  /** Each application's channel, where the harness hands it; else read per row. */
  readonly channel?: (appId: string) => Controls<"hqAppSlack">;
}) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const view = setting.state === "known" ? setting.held : null;
  return (
    <SettingsRow
      control={
        view?.connected === true ? (
          <Button
            disabled={working(read.action)}
            onClick={() => {
              write({ kind: "slack-disconnect" });
            }}
            size="sm"
            variant="ghost"
          >
            {pressWords(read.action, ["slack-disconnect"], "Disconnect")}
          </Button>
        ) : undefined
      }
      data-zerops-surface="settings-slack"
      description="Mention Mate in a channel an application takes tasks from: the thread becomes the task's conversation, and Mate answers there."
      status={statusOf(setting, slackLine)}
      title="Slack"
    >
      <div className="grid gap-3 px-3 pb-3 sm:px-4">
        {view === null ? (
          <NotKnown
            onAgain={again}
            quiet
            setting={setting}
            // An unconnected organization's steps: the shape most land in.
            template={<SlackSteps controls={UNSEEN} manifest={UNSEEN} />}
          />
        ) : view.connected ? (
          <AppRows apps={apps}>
            {(app) =>
              channel === undefined ? (
                <AppChannelRow appId={app.id} family="hqAppSlack" source="slack" />
              ) : (
                <AppChannelView controls={channel(app.id)} source="slack" />
              )
            }
          </AppRows>
        ) : manifest === undefined ? (
          <SlackStepsWithManifest controls={controls} />
        ) : (
          <SlackSteps controls={controls} manifest={manifest} />
        )}
        <Problem read={read} />
      </div>
    </SettingsRow>
  );
}

function SlackStepsWithManifest({ controls }: { readonly controls: Controls<"hqSlack"> }) {
  const manifest = useOrgTaskSource("hqSlackManifest");
  return <SlackSteps controls={controls} manifest={manifest} />;
}

function SlackSteps({
  controls,
  manifest,
}: {
  readonly controls: Controls<"hqSlack">;
  readonly manifest: Controls<"hqSlackManifest">;
}) {
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "Slack manifest" });
  const text = manifest.read.setting.state === "known" ? manifest.read.setting.held : null;
  const ready = botToken.trim().length > 0 && signingSecret.trim().length > 0;
  return (
    <ol className="grid gap-3">
      <Step n={1}>
        <p>Create a Slack app from this manifest.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={text === null}
            onClick={() => {
              if (text !== null) copyToClipboard(text, undefined);
            }}
            size="sm"
            variant="secondary"
          >
            {isCopied ? "Copied" : "Copy manifest"}
          </Button>
          <OutLink href={SLACK_NEW_APP}>Open Slack apps</OutLink>
          {manifest.read.setting.state === "failed" ? (
            <span className="text-xs text-muted-foreground" role="alert">
              {manifest.read.setting.words}
            </span>
          ) : null}
        </div>
      </Step>
      <Step n={2}>
        <p>Install it to your workspace.</p>
      </Step>
      <Step n={3}>
        <p>
          Paste its bot token (OAuth & Permissions) and its signing secret (Basic Information). HQ
          keeps both sealed and never shows them again.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            controls.write(
              { kind: "slack-connect" },
              { botToken: botToken.trim(), signingSecret: signingSecret.trim() },
            );
            setBotToken("");
            setSigningSecret("");
          }}
        >
          <SecretField label="Bot token" onChange={setBotToken} value={botToken} />
          <SecretField label="Signing secret" onChange={setSigningSecret} value={signingSecret} />
          <Button disabled={!ready || working(controls.read.action)} size="sm" type="submit">
            {pressWords(controls.read.action, ["slack-connect"], "Connect")}
          </Button>
        </form>
      </Step>
    </ol>
  );
}

// ── an application's channel, on Slack or Discord ───────────────────────────────────────────

function AppChannelRow({
  appId,
  family,
  source,
}: {
  readonly appId: string;
  readonly family: "hqAppSlack" | "hqAppDiscord";
  readonly source: "slack" | "discord";
}) {
  const controls = useAppTaskSource(family, appId);
  return <AppChannelView controls={controls} source={source} />;
}

// ── Discord ─────────────────────────────────────────────────────────────────────────────────

export function DiscordSettingsView({
  controls,
  apps,
  channel,
}: {
  readonly controls: Controls<"hqDiscord">;
  readonly apps: ReadonlyArray<App> | null;
  readonly channel?: (appId: string) => Controls<"hqAppDiscord">;
}) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const view = setting.state === "known" ? setting.held : null;
  return (
    <SettingsRow
      control={
        view?.connected === true ? (
          <Button
            disabled={working(read.action)}
            onClick={() => {
              write({ kind: "discord-disconnect" });
            }}
            size="sm"
            variant="ghost"
          >
            {pressWords(read.action, ["discord-disconnect"], "Disconnect")}
          </Button>
        ) : undefined
      }
      data-zerops-surface="settings-discord"
      description="Allowed people type /mate task in a channel an application takes tasks from: Mate opens a thread for it, and /mate reply there steers it."
      status={statusOf(setting, (known) => (known.connected ? "Connected" : "Not connected"))}
      title="Discord"
    >
      <div className="grid gap-3 px-3 pb-3 sm:px-4">
        {view === null ? (
          <NotKnown
            onAgain={again}
            quiet
            setting={setting}
            template={<DiscordSteps controls={UNSEEN} view={DISCORD_OFF} />}
          />
        ) : view.connected ? (
          <>
            <DiscordConnected controls={controls} view={view} />
            <AppRows apps={apps}>
              {(app) =>
                channel === undefined ? (
                  <AppChannelRow appId={app.id} family="hqAppDiscord" source="discord" />
                ) : (
                  <AppChannelView controls={channel(app.id)} source="discord" />
                )
              }
            </AppRows>
          </>
        ) : (
          <DiscordSteps controls={controls} view={view} />
        )}
        <Problem read={read} />
      </div>
    </SettingsRow>
  );
}

function DiscordSteps({
  controls,
  view,
}: {
  readonly controls: Controls<"hqDiscord">;
  readonly view: HqDiscordView;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [botToken, setBotToken] = useState("");
  const ready =
    applicationId.trim().length > 0 && publicKey.trim().length > 0 && botToken.trim().length > 0;
  return (
    <ol className="grid gap-3">
      <Step n={1}>
        <p>
          Make an application in the Discord Developer Portal.{" "}
          <OutLink href={DISCORD_PORTAL}>Open the portal</OutLink>
        </p>
      </Step>
      <Step n={2}>
        <p>Paste its application ID, public key and bot token. HQ keeps the token sealed.</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            controls.write(
              {
                kind: "discord-connect",
                applicationId: applicationId.trim(),
                publicKey: publicKey.trim(),
              },
              { botToken: botToken.trim() },
            );
            setBotToken("");
          }}
        >
          <TextField label="Application ID" onChange={setApplicationId} value={applicationId} />
          <TextField label="Public key" onChange={setPublicKey} value={publicKey} />
          <SecretField label="Bot token" onChange={setBotToken} value={botToken} />
          <Button disabled={!ready || working(controls.read.action)} size="sm" type="submit">
            {pressWords(controls.read.action, ["discord-connect"], "Connect")}
          </Button>
        </form>
      </Step>
      <Step n={3}>
        {/* HQ names the address only once the application is connected. */}
        {view.interactionsUrl === "" ? (
          <p>
            Then set its Interactions Endpoint URL to the address that appears here once it is
            connected, and add the bot to your server.
          </p>
        ) : (
          <>
            <p>Then set its Interactions Endpoint URL to this, and add the bot to your server.</p>
            <CopyLine copy="Copy URL" label="Endpoint URL" value={view.interactionsUrl} />
          </>
        )}
      </Step>
    </ol>
  );
}

function DiscordConnected({
  controls,
  view,
}: {
  readonly controls: Controls<"hqDiscord">;
  readonly view: HqDiscordView;
}) {
  const [adding, setAdding] = useState("");
  const hintId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = working(controls.read.action);
  const change = (next: Parameters<typeof allowlistAfter>[1]) => {
    const after = allowlistAfter(view.allowed, next);
    if ("error" in after) {
      setRefusal(after.error);
      return false;
    }
    setRefusal(null);
    controls.write({ kind: "discord-allow", userIds: after.userIds });
    return true;
  };
  return (
    <div className="grid gap-3">
      <CopyLine copy="Copy URL" label="Endpoint URL" value={view.interactionsUrl} />
      {view.inviteUrl === null ? null : (
        <p className="text-xs text-foreground">
          <OutLink href={view.inviteUrl}>Add the bot to a server</OutLink>
        </p>
      )}
      <div className="grid gap-2" data-zerops-surface="settings-discord-allowed">
        <p className="text-xs text-muted-foreground">
          {view.allowed.length === 0
            ? "Nobody may start a task yet: add the Discord user IDs of who may."
            : "Who may start and steer tasks, by Discord user ID:"}
        </p>
        {view.allowed.length === 0 ? null : (
          <ul className="grid gap-1">
            {view.allowed.map((id) => (
              <li className="flex items-center justify-between gap-2" key={id}>
                <code className="min-w-0 truncate font-mono text-xs text-foreground">{id}</code>
                <Button
                  disabled={busy}
                  onClick={() => {
                    change({ remove: id });
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (change({ add: adding })) setAdding("");
          }}
        >
          <TextField
            describedBy={hintId}
            label="Discord user ID"
            onChange={setAdding}
            value={adding}
            width="w-56"
          />
          <Button disabled={busy || adding.trim().length === 0} size="sm" type="submit">
            {pressWords(controls.read.action, ["discord-allow"], "Add")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground" id={hintId}>
          With Developer Mode on (User Settings › Advanced), right-click a person › Copy User ID.
        </p>
        {refusal === null ? null : (
          <p className="text-xs text-destructive-foreground" role="alert">
            {refusal}
          </p>
        )}
      </div>
    </div>
  );
}

// ── webhooks ────────────────────────────────────────────────────────────────────────────────

function WebhooksSettings({ apps }: { readonly apps: ReadonlyArray<App> | null }) {
  return (
    <WebhooksSettingsView apps={apps}>
      {(app) => <AppWebhooksRow appId={app.id} name={app.name} />}
    </WebhooksSettingsView>
  );
}

export function WebhooksSettingsView({
  apps,
  children,
}: {
  readonly apps: ReadonlyArray<App> | null;
  readonly children: (app: App) => ReactNode;
}) {
  return (
    <SettingsRow
      data-zerops-surface="settings-webhooks"
      description={
        <>
          Anything that can send a signed request starts a task: POST JSON with{" "}
          <code className="font-mono">title</code> and <code className="font-mono">body</code> to
          the webhook's URL, signed in <code className="font-mono">X-Mate-Signature</code> as{" "}
          <code className="font-mono">sha256=</code> and the body's HMAC-SHA256 with its secret.
        </>
      }
      title="Webhooks"
    >
      <div className="px-3 pb-3 sm:px-4">
        <AppRows apps={apps}>{children}</AppRows>
      </div>
    </SettingsRow>
  );
}

function AppWebhooksRow({ appId, name }: { readonly appId: string; readonly name: string }) {
  const controls = useAppTaskSource("hqAppWebhooks", appId);
  return <AppWebhooksView controls={controls} name={name} />;
}

// ── schedules ───────────────────────────────────────────────────────────────────────────────

function SchedulesSettings({ apps }: { readonly apps: ReadonlyArray<App> | null }) {
  return (
    <SchedulesSettingsView apps={apps}>
      {(app) => <AppSchedulesRow appId={app.id} name={app.name} />}
    </SchedulesSettingsView>
  );
}

export function SchedulesSettingsView({
  apps,
  children,
}: {
  readonly apps: ReadonlyArray<App> | null;
  readonly children: (app: App) => ReactNode;
}) {
  return (
    <SettingsRow
      data-zerops-surface="settings-schedules"
      description="A brief an application's automated Mates get as a task each time it is due, such as updating dependencies every Monday morning."
      title="Schedules"
    >
      <div className="px-3 pb-3 sm:px-4">
        <AppRows apps={apps}>{children}</AppRows>
      </div>
    </SettingsRow>
  );
}

function AppSchedulesRow({ appId, name }: { readonly appId: string; readonly name: string }) {
  const controls = useAppTaskSource("hqAppSchedules", appId);
  return <AppSchedulesView controls={controls} name={name} />;
}

// ── limits per task ─────────────────────────────────────────────────────────────────────────

export function TaskLimitsView({ controls }: { readonly controls: Controls<"hqTaskLimits"> }) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const held: HqTaskLimitsView | null = setting.state === "known" ? setting.held : null;
  // What is typed; `null` while untouched: the field shows what HQ holds.
  const [minutes, setMinutes] = useState<string | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Saved and not yet settled: what was typed stays shown until HQ's read after it lands, or HQ
  // refuses it — never the limits as they were for a frame in between.
  const [sent, setSent] = useState(false);
  const settled = ["done", "failed", "unresolved"].includes(read.action.kind);
  if (sent && settled) {
    setSent(false);
    setMinutes(null);
    setCost(null);
  }
  const minutesId = useId();
  const costId = useId();
  const shownMinutes = minutes ?? (held === null ? "" : String(held.minutes));
  const shownCost = cost ?? (held?.costUsd == null ? "" : String(held.costUsd));
  return (
    <SettingsRow
      data-zerops-surface="settings-task-limits"
      description="A task that reaches either stops, and says where it got to."
      status={statusOf(setting, limitsLine)}
      title="Limits per task"
    >
      <div className="grid gap-2 px-3 pb-3 sm:px-4">
        {held === null ? (
          <NotKnown onAgain={again} quiet setting={setting} />
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const typed = readLimits(shownMinutes, shownCost);
              if ("error" in typed) {
                setRefusal(typed.error);
                return;
              }
              setRefusal(null);
              setSent(true);
              write({ kind: "task-limits", limits: typed.limits });
            }}
          >
            <div className="grid w-28 gap-1.5">
              <Label htmlFor={minutesId}>Minutes</Label>
              <Input
                id={minutesId}
                inputMode="numeric"
                onChange={(event) => {
                  setMinutes(event.target.value);
                }}
                size="sm"
                value={shownMinutes}
              />
            </div>
            <div className="grid w-28 gap-1.5">
              <Label htmlFor={costId}>Cost (USD)</Label>
              <Input
                id={costId}
                inputMode="decimal"
                onChange={(event) => {
                  setCost(event.target.value);
                }}
                placeholder="No limit"
                size="sm"
                value={shownCost}
              />
            </div>
            <Button
              disabled={sent || working(read.action) || (minutes === null && cost === null)}
              size="sm"
              type="submit"
            >
              {pressWords(read.action, ["task-limits"], "Save")}
            </Button>
          </form>
        )}
        {refusal === null ? null : (
          <p className="text-xs text-destructive-foreground" role="alert">
            {refusal}
          </p>
        )}
        <Problem read={read} />
      </div>
    </SettingsRow>
  );
}
