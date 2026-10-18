/**
 * Where automated Mates take tasks from besides GitHub. In Settings › Automation, for the
 * organization's Owner and Admins: its Slack app — made from the manifest HQ gives, its tokens
 * pasted here and never shown back — its Discord application with who may use it, and the limits
 * on each task. Per application (a project's page shows them): the channel it takes tasks from
 * on each, its signed webhooks (the secret shown once, as it is made) and its schedules. An HQ
 * older than these says so in one line, and none of them is drawn.
 *
 * Each part paints in its final shape while it is read (`IntakeRoom`): nothing it reads moves what
 * the person is about to press.
 */
import type { AppSetting, OrgSetting, SettingValue } from "@t3tools/client-runtime/data";
import type { HqDiscordView, HqSlackView, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { TimerIcon, WalletIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useOrgTaskSource, type TaskSourceControls } from "~/zerops/useTaskSourceSettings";

import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { HeldRoom, IntakeRoom, pressWords, TextField, WITHHELD, working } from "./automationParts";
import {
  AppChannelView,
  AppSchedulesView,
  AppWebhooksView,
} from "../zerops/projectAutomation/sourceForms";

// A project's sources' forms live on its page (`projectAutomation/sourceForms`); importable from here.
export { AppChannelView, AppSchedulesView, AppWebhooksView };
import {
  AddressField,
  ConnectCard,
  FlowSurface,
  ConnectStep,
  KeyField,
  OutButton,
  PendingAddress,
} from "./ConnectFlow";
import {
  DiscordMark,
  IntegrationAction,
  IntegrationRow,
  IntegrationSetting,
  LimitsList,
  SlackMark,
  type IntegrationState,
} from "./IntegrationRow";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  allowlistAfter,
  budgetLine,
  connectKeyProblem,
  connectKeysReady,
  limitsLine,
  readBudget,
  readLimits,
  SLACK_NEW_APP,
  slackLine,
  slackManifestApp,
  taskSourceProblem,
  taskSourcesUnsupported,
} from "./taskSourcesSettings.logic";

const DISCORD_PORTAL = "https://discord.com/developers/applications";

type Controls<F extends OrgSetting | AppSetting> = TaskSourceControls<F>;

interface App {
  readonly id: string;
  readonly name: string;
}

/**
 * Settings › Automation's organization-wide sources: its Slack app, its Discord application and
 * the limits on each task. Which channel, webhooks and schedules feed a project's automated Mates
 * is set on that project's page.
 */
export function TaskSourcesSettings() {
  const slack = useOrgTaskSource("hqSlack");
  const discord = useOrgTaskSource("hqDiscord");
  if (taskSourcesUnsupported([slack.read.setting, discord.read.setting]))
    return (
      <li className="px-4 py-3">
        <TaskSourcesUnsupported />
      </li>
    );
  return (
    <>
      <SlackSettingsView controls={slack} />
      <DiscordSettingsView controls={discord} />
    </>
  );
}

/** Settings › Automation's limits on each task, under its list. */
export function TaskLimitsSettings() {
  const limits = useOrgTaskSource("hqTaskLimits");
  if (limits.read.setting.state === "unsupported") return null;
  return (
    <LimitsList>
      <TaskLimitsView controls={limits} />
      <MonthlyBudgetView controls={limits} />
    </LimitsList>
  );
}

/** In these settings' place, where this HQ predates them. */
export function TaskSourcesUnsupported() {
  return (
    <p
      className="text-sm text-muted-foreground"
      data-zerops-surface="settings-task-sources-unsupported"
    >
      Update HQ to take tasks from Slack, Discord, webhooks and schedules.
    </p>
  );
}

// ── the parts every section shares ──────────────────────────────────────────────────────────

const TASK_SOURCES_UPDATE = "Update HQ to take tasks from Slack, Discord, webhooks and schedules.";

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

/**
 * A connection's row opened by its press, folded again once it disconnects — and once it connects,
 * unless what it opens next is the next step (`stayOnConnect`): what the press opened was for the
 * state that just ended.
 */
function useOpenUntil(connected: boolean | null, defaultOpen: boolean, stayOnConnect: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  const [seen, setSeen] = useState(connected);
  if (seen !== connected) {
    setSeen(connected);
    if (seen !== null && !(stayOnConnect && connected === true)) setOpen(false);
  }
  return [open, setOpen] as const;
}

/** A connection's pill, from what is read: *Checking…* until HQ answers. */
function sourceState<T>(
  setting: SettingValue<T>,
  connected: (held: T) => boolean,
): IntegrationState {
  switch (setting.state) {
    case "known":
      return connected(setting.held)
        ? { kind: "on", words: "Connected" }
        : { kind: "off", words: "Not connected" };
    case "unread":
    case "reading":
      return { kind: "checking" };
    default:
      return { kind: "none" };
  }
}

/** A connection's one line: a refusal, HQ's failure, or where it stands; its purpose until known. */
function sourceLine<T>(
  read: { readonly action: Parameters<typeof taskSourceProblem>[0] },
  setting: SettingValue<T>,
  purpose: string,
  connected: (held: T) => string,
): ReactNode {
  const problem = taskSourceProblem(read.action);
  if (problem !== null)
    return (
      <span className="text-destructive-foreground" role="alert">
        {problem}
      </span>
    );
  if (setting.state === "known") {
    const said = connected(setting.held);
    return said === "Not connected" ? purpose : said;
  }
  if (setting.state === "failed") return setting.words;
  if (setting.state === "withheld") return WITHHELD;
  if (setting.state === "unsupported") return TASK_SOURCES_UPDATE;
  return purpose;
}

/**
 * A connection's one press: *Connect* while it is not — a quiet one, as these sources are optional,
 * its steps carrying their own Cancel — *Manage* once it is, *Read again* where HQ failed; and
 * while it is read, *Connect*'s room, held unseen so nothing moves as it lands.
 */
function SourceAction({
  setting,
  connected,
  open,
  onToggle,
  again,
}: {
  readonly setting: SettingValue<unknown>;
  readonly connected: boolean | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly again: () => void;
}) {
  if (setting.state === "failed")
    return (
      <Button onClick={again} size="sm" variant="secondary">
        Read again
      </Button>
    );
  if (connected === null)
    return setting.state === "unread" || setting.state === "reading" ? (
      <HeldRoom
        template={
          <Button size="sm" tabIndex={-1} variant="secondary">
            Connect
          </Button>
        }
      >
        {null}
      </HeldRoom>
    ) : null;
  return (
    <IntegrationAction
      closeWords={connected ? "Close" : null}
      onToggle={onToggle}
      open={open}
      primary={false}
    >
      {connected ? "Manage" : "Connect"}
    </IntegrationAction>
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
  manifest,
  defaultOpen = false,
}: {
  readonly controls: Controls<"hqSlack">;
  /** The manifest's read, where the harness hands it; else read while the steps show. */
  readonly manifest?: Controls<"hqSlackManifest">;
  /** Its press's part opened from the start: the harness's and a test's. */
  readonly defaultOpen?: boolean;
}) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const view = setting.state === "known" ? setting.held : null;
  // Connected, nothing is left to do here: each project's channel is set on its page.
  const [open, setOpen] = useOpenUntil(view?.connected ?? null, defaultOpen, false);
  const close = () => setOpen(false);
  return (
    <IntegrationRow
      action={
        <SourceAction
          again={again}
          connected={view?.connected ?? null}
          onToggle={() => setOpen(!open)}
          open={open}
          setting={setting}
        />
      }
      id={searchableSetting("automation-slack").id}
      line={sourceLine(
        read,
        setting,
        "Mention Mate in a project's channel: the thread becomes the task, and Mate answers there.",
        slackLine,
      )}
      mark={<SlackMark />}
      name="Slack"
      open={open && view !== null}
      state={sourceState(setting, (held) => held.connected)}
      surface="settings-slack"
    >
      {view === null ? null : view.connected ? (
        <ManagePanel
          disconnect={
            <InlineButton
              disabled={working(read.action)}
              onClick={() => {
                write({ kind: "slack-disconnect" });
              }}
              tone="destructive"
            >
              {pressWords(read.action, ["slack-disconnect"], "Disconnect")}
            </InlineButton>
          }
          warning="Disconnecting stops every project taking tasks from Slack."
        >
          <AddressField
            hint="Where Slack sends what happens in the workspace: Event Subscriptions › Request URL."
            label="Request URL"
            value={view.eventsUrl}
          />
        </ManagePanel>
      ) : manifest === undefined ? (
        <SlackStepsWithManifest controls={controls} onCancel={close} view={view} />
      ) : (
        <SlackSteps controls={controls} manifest={manifest} onCancel={close} view={view} />
      )}
    </IntegrationRow>
  );
}

function SlackStepsWithManifest(props: {
  readonly controls: Controls<"hqSlack">;
  readonly view: HqSlackView;
  readonly onCancel: () => void;
}) {
  const manifest = useOrgTaskSource("hqSlackManifest");
  return <SlackSteps {...props} manifest={manifest} />;
}

function SlackSteps({
  controls,
  manifest,
  view,
  onCancel,
}: {
  readonly controls: Controls<"hqSlack">;
  readonly manifest: Controls<"hqSlackManifest">;
  readonly view: HqSlackView;
  readonly onCancel: () => void;
}) {
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "Slack manifest" });
  const read = manifest.read.setting;
  const text = read.state === "known" ? read.held : null;
  const app = text === null ? null : slackManifestApp(text);
  const ready = connectKeysReady([
    ["slack-bot-token", botToken],
    ["slack-signing-secret", signingSecret],
  ]);
  return (
    <ConnectCard
      busy={working(controls.read.action)}
      note="HQ keeps both keys sealed and never shows them again."
      onCancel={onCancel}
      onSubmit={() => {
        controls.write(
          { kind: "slack-connect" },
          { botToken: botToken.trim(), signingSecret: signingSecret.trim() },
        );
        setBotToken("");
        setSigningSecret("");
      }}
      ready={ready}
      submit={pressWords(controls.read.action, ["slack-connect"], "Connect")}
    >
      <ConnectStep
        help={
          read.state === "failed"
            ? "HQ's manifest is not at hand, so make the app by hand on Slack's page."
            : "Slack fills in its name, permissions and the address below from HQ's manifest."
        }
        n={1}
        title="Create the Slack app"
      >
        <div className="flex flex-wrap items-center gap-2">
          {app === null ? (
            <OutButton href={SLACK_NEW_APP}>Open Slack apps</OutButton>
          ) : (
            <OutButton href={app.createUrl}>Create the Slack app</OutButton>
          )}
          <Button
            disabled={text === null}
            onClick={() => {
              if (text !== null) copyToClipboard(text, undefined);
            }}
            size="sm"
            variant="ghost"
          >
            {isCopied ? "Copied" : "Copy manifest"}
          </Button>
          {read.state === "failed" ? (
            <span className="text-xs text-destructive-foreground" role="alert">
              {read.words}
            </span>
          ) : null}
        </div>
        <AddressField
          hint="Event Subscriptions › Request URL. The manifest sets it; paste it there only if you make the app by hand."
          label="Request URL"
          value={view.eventsUrl}
        />
      </ConnectStep>
      <ConnectStep
        help="On the app's Install App page, press Install to Workspace and allow it."
        n={2}
        title="Install it to your workspace"
      />
      <ConnectStep n={3} title="Paste its keys">
        <KeyField
          autoFocus
          hint="OAuth & Permissions › Bot User OAuth Token. It starts with xoxb-."
          label="Bot token"
          onChange={setBotToken}
          problem={connectKeyProblem("slack-bot-token", botToken)}
          secret
          value={botToken}
        />
        <KeyField
          hint="Basic Information › App Credentials › Signing Secret."
          label="Signing secret"
          onChange={setSigningSecret}
          problem={connectKeyProblem("slack-signing-secret", signingSecret)}
          secret
          value={signingSecret}
        />
      </ConnectStep>
    </ConnectCard>
  );
}

// ── Discord ─────────────────────────────────────────────────────────────────────────────────

const DISCORD_ENDPOINT = "Interactions Endpoint URL";

export function DiscordSettingsView({
  controls,
  defaultOpen = false,
}: {
  readonly controls: Controls<"hqDiscord">;
  /** Its press's part opened from the start: the harness's and a test's. */
  readonly defaultOpen?: boolean;
}) {
  const { read, write, again } = controls;
  const setting = read.setting;
  const view = setting.state === "known" ? setting.held : null;
  // Connected from its steps, it stays open: the address and the invite are the next steps.
  const [open, setOpen] = useOpenUntil(view?.connected ?? null, defaultOpen, true);
  return (
    <IntegrationRow
      action={
        <SourceAction
          again={again}
          connected={view?.connected ?? null}
          onToggle={() => setOpen(!open)}
          open={open}
          setting={setting}
        />
      }
      id={searchableSetting("automation-discord").id}
      line={sourceLine(
        read,
        setting,
        "Allowed people type /mate task in a project's channel, and /mate reply in its thread.",
        (held) =>
          !held.connected
            ? "Not connected"
            : held.allowed.length === 0
              ? "Connected · nobody may start a task yet"
              : `Connected · ${held.allowed.length} ${held.allowed.length === 1 ? "person may" : "people may"} start tasks`,
      )}
      mark={<DiscordMark />}
      name="Discord"
      open={open && view !== null}
      state={sourceState(setting, (held) => held.connected)}
      surface="settings-discord"
    >
      {view === null ? null : view.connected ? (
        <ManagePanel
          disconnect={
            <InlineButton
              disabled={working(read.action)}
              onClick={() => {
                write({ kind: "discord-disconnect" });
              }}
              tone="destructive"
            >
              {pressWords(read.action, ["discord-disconnect"], "Disconnect")}
            </InlineButton>
          }
          warning="Disconnecting stops every project taking tasks from Discord."
        >
          <DiscordConnected controls={controls} view={view} />
        </ManagePanel>
      ) : (
        <DiscordSteps
          controls={controls}
          onCancel={() => {
            setOpen(false);
          }}
          view={view}
        />
      )}
    </IntegrationRow>
  );
}

function DiscordSteps({
  controls,
  view,
  onCancel,
}: {
  readonly controls: Controls<"hqDiscord">;
  readonly view: HqDiscordView;
  readonly onCancel: () => void;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [botToken, setBotToken] = useState("");
  const ready = connectKeysReady([
    ["discord-application-id", applicationId],
    ["discord-public-key", publicKey],
    ["discord-bot-token", botToken],
  ]);
  return (
    <ConnectCard
      busy={working(controls.read.action)}
      note="HQ keeps the bot token sealed and never shows it again."
      onCancel={onCancel}
      onSubmit={() => {
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
      ready={ready}
      submit={pressWords(controls.read.action, ["discord-connect"], "Connect")}
    >
      <ConnectStep
        help="In the Developer Portal, press New Application and name it Mate."
        n={1}
        title="Create a Discord application"
      >
        <div className="flex">
          <OutButton href={DISCORD_PORTAL}>Open the Developer Portal</OutButton>
        </div>
      </ConnectStep>
      <ConnectStep n={2} title="Paste its keys">
        <KeyField
          autoFocus
          hint="General Information › Application ID."
          label="Application ID"
          onChange={setApplicationId}
          problem={connectKeyProblem("discord-application-id", applicationId)}
          value={applicationId}
        />
        <KeyField
          hint="General Information › Public Key."
          label="Public key"
          onChange={setPublicKey}
          problem={connectKeyProblem("discord-public-key", publicKey)}
          value={publicKey}
        />
        <KeyField
          hint="Bot › Reset Token, then copy it."
          label="Bot token"
          onChange={setBotToken}
          problem={connectKeyProblem("discord-bot-token", botToken)}
          secret
          value={botToken}
        />
      </ConnectStep>
      {/* Discord checks the address against the application's key, which HQ holds only once
          connected: HQ names it then, and an earlier one would fail Discord's check. */}
      <ConnectStep
        help={
          view.interactionsUrl === ""
            ? "After Connect, paste HQ's address into General Information, then invite the bot."
            : "After Connect, paste this into General Information, then invite the bot."
        }
        n={3}
        title="Point Discord at HQ"
      >
        {view.interactionsUrl === "" ? (
          <PendingAddress
            label={DISCORD_ENDPOINT}
            words="The address appears here once connected."
          />
        ) : (
          <AddressField label={DISCORD_ENDPOINT} value={view.interactionsUrl} />
        )}
      </ConnectStep>
    </ConnectCard>
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
    <>
      <AddressField
        hint="General Information › Interactions Endpoint URL: Discord sends /mate here."
        label={DISCORD_ENDPOINT}
        value={view.interactionsUrl}
      />
      {view.inviteUrl === null ? null : (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium text-foreground">Servers</p>
          <div className="flex">
            <OutButton href={view.inviteUrl}>Add the bot to a server</OutButton>
          </div>
        </div>
      )}
      <div className="grid gap-1.5" data-zerops-surface="settings-discord-allowed">
        <p className="text-sm font-medium text-foreground">Who may start and steer tasks</p>
        {view.allowed.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody may start a task yet: add the Discord user IDs of who may.
          </p>
        ) : null}
        {view.allowed.length === 0 ? null : (
          <ul className="grid divide-y divide-border rounded-md border border-border bg-background">
            {view.allowed.map((id) => (
              <li className="flex items-center justify-between gap-2 py-1 ps-2.5 pe-1" key={id}>
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
          className="flex items-end gap-2"
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
    </>
  );
}

/** What a connected row's Manage opens: what it holds, then Disconnect beside what that stops. */
function ManagePanel({
  warning,
  disconnect,
  children,
}: {
  readonly warning: string;
  readonly disconnect: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <FlowSurface>
      <div className="grid gap-4">
        {children}
        <div className="flex items-center gap-4 border-t border-border/70 pt-3 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">{warning}</span>
          {disconnect}
        </div>
      </div>
    </FlowSurface>
  );
}

// ── webhooks ────────────────────────────────────────────────────────────────────────────────

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
      <div className="px-3 pb-3">
        <AppRows apps={apps}>{children}</AppRows>
      </div>
    </SettingsRow>
  );
}

// ── schedules ───────────────────────────────────────────────────────────────────────────────

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
      <div className="px-3 pb-3">
        <AppRows apps={apps}>{children}</AppRows>
      </div>
    </SettingsRow>
  );
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
  const save = useOwnSave(read.action);
  if (save.settled !== null) {
    setRefusal(save.settled.refusal);
    setMinutes(null);
    setCost(null);
  }
  const sent = save.sent;
  const minutesId = useId();
  const costId = useId();
  const shownMinutes = minutes ?? (held === null ? "" : String(held.minutes));
  const shownCost = cost ?? (held?.costUsd == null ? "" : String(held.costUsd));
  return (
    <IntegrationSetting
      control={
        held === null ? (
          setting.state === "failed" ? (
            <Button onClick={again} size="sm" variant="secondary">
              Read again
            </Button>
          ) : (
            <HeldRoom template={<LimitsFields cost="" minutes="" />}>{null}</HeldRoom>
          )
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const typed = readLimits(shownMinutes, shownCost);
              if ("error" in typed) {
                setRefusal(typed.error);
                return;
              }
              setRefusal(null);
              save.send();
              write({ kind: "task-limits", limits: typed.limits });
            }}
          >
            <LimitsFields
              cost={shownCost}
              costId={costId}
              minutes={shownMinutes}
              minutesId={minutesId}
              onCost={setCost}
              onMinutes={setMinutes}
            >
              <Button
                disabled={sent || working(read.action) || (minutes === null && cost === null)}
                size="sm"
                type="submit"
                variant="secondary"
              >
                <SaveWords sent={sent} />
              </Button>
            </LimitsFields>
          </form>
        )
      }
      id={searchableSetting("automation-limits").id}
      line={statusOf(setting, limitsLine)}
      mark={<TimerIcon className="size-5" />}
      name="Limits per task"
      surface="settings-task-limits"
    >
      {refusal === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {refusal}
        </p>
      )}
    </IntegrationSetting>
  );
}

/**
 * What all the organization's automated Mates may spend in a calendar month (UTC), and what they
 * spent so far: once spent, HQ starts no task and stops those at work. Saved beside the limits per
 * task, which it keeps as HQ holds them. An HQ that predates it shows no row.
 */
export function MonthlyBudgetView({ controls }: { readonly controls: Controls<"hqTaskLimits"> }) {
  const { read, write } = controls;
  const setting = read.setting;
  const held: HqTaskLimitsView | null = setting.state === "known" ? setting.held : null;
  const [typed, setTyped] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A refused amount stays typed beside why, to correct and save again.
  const save = useOwnSave(read.action);
  if (save.settled !== null) {
    setRefusal(save.settled.refusal);
    if (save.settled.refusal === null) setTyped(null);
  }
  const sent = save.sent;
  const fieldId = useId();
  if (held !== null && held.spentThisMonthUsd === undefined) return null;
  const shown = typed ?? (held?.monthlyBudgetUsd == null ? "" : String(held.monthlyBudgetUsd));
  return (
    <IntegrationSetting
      control={
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (held === null) return;
            const budget = readBudget(shown);
            if ("error" in budget) {
              setRefusal(budget.error);
              return;
            }
            setRefusal(null);
            save.send();
            write({
              kind: "task-limits",
              limits: {
                minutes: held.minutes,
                costUsd: held.costUsd,
                monthlyBudgetUsd: budget.budgetUsd,
              },
            });
          }}
        >
          <Label htmlFor={fieldId}>USD a month</Label>
          <div className="w-24">
            <Input
              disabled={held === null}
              id={fieldId}
              inputMode="decimal"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              placeholder="No budget"
              size="sm"
              value={shown}
            />
          </div>
          <Button
            disabled={held === null || sent || working(read.action) || typed === null}
            size="sm"
            type="submit"
            variant="secondary"
          >
            <SaveWords sent={sent} />
          </Button>
        </form>
      }
      line={held === null ? "Reading…" : budgetLine(held)}
      mark={<WalletIcon className="size-5" />}
      name="Monthly budget"
      surface="settings-monthly-budget"
    >
      {refusal === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {refusal}
        </p>
      )}
    </IntegrationSetting>
  );
}

type LimitsAction = Controls<"hqTaskLimits">["read"]["action"];

/** A limits row's press: as wide as "Saving…" from the first frame, so nothing beside it moves. */
function SaveWords({ sent }: { readonly sent: boolean }) {
  return (
    <span className="grid">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        Saving…
      </span>
      <span className="col-start-1 row-start-1">{sent ? "Saving…" : "Save"}</span>
    </span>
  );
}

/**
 * A row's own save on the limits record the two rows share: sent from it until HQ answers the
 * write it made, and the answer once (`settled`, its refusal's words or none) — never the other
 * row's write, nor the answer to an earlier one still shown when this one is sent.
 */
function useOwnSave(action: LimitsAction) {
  // The action shown as this row's write was sent; `null` while it has none under way.
  const [from, setFrom] = useState<{ readonly action: LimitsAction } | null>(null);
  const answered =
    from !== null &&
    action !== from.action &&
    (action.kind === "done" || action.kind === "failed" || action.kind === "unresolved");
  if (answered) setFrom(null);
  return {
    sent: from !== null && !answered,
    settled: answered ? { refusal: taskSourceProblem(action) } : null,
    send: () => {
      setFrom({ action });
    },
  };
}

/** The limits' two fields side by side, each labelled beside it, and the press after them. */
function LimitsFields({
  minutes,
  cost,
  minutesId,
  costId,
  onMinutes,
  onCost,
  children,
}: {
  readonly minutes: string;
  readonly cost: string;
  readonly minutesId?: string;
  readonly costId?: string;
  readonly onMinutes?: (value: string) => void;
  readonly onCost?: (value: string) => void;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={minutesId}>Minutes</Label>
      <div className="w-16">
        <Input
          id={minutesId}
          inputMode="numeric"
          onChange={(event) => {
            onMinutes?.(event.target.value);
          }}
          size="sm"
          value={minutes}
        />
      </div>
      <Label htmlFor={costId}>Cost, USD</Label>
      <div className="w-24">
        <Input
          id={costId}
          inputMode="decimal"
          onChange={(event) => {
            onCost?.(event.target.value);
          }}
          placeholder="No limit"
          size="sm"
          value={cost}
        />
      </div>
      {children ?? (
        <Button size="sm" variant="secondary">
          Save
        </Button>
      )}
    </div>
  );
}
