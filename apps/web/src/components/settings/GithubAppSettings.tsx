/**
 * Settings › Automation › GitHub: the GitHub accounts Mate works in, which is what people come
 * here for, as rows — each its name, the repositories Mate may use there and how many of Mate's
 * code repositories are connected to one, and the way to its repositories on GitHub. Mate works
 * on GitHub as a bot (a GitHub app the organization made); an organization may have several, so
 * the accounts stand under one quiet line per bot: its name, the login it writes as, whose it is
 * where it is a person's own account (it leaves with them), who set it up. What is done to a bot
 * is behind its menu: add an account with it, open it on GitHub, remove it — *Remove…* names every
 * Mate repository that stops before HQ forgets it.
 *
 * An account added from here comes back accepted; one added on GitHub waits as a row of its own
 * for the Owner's or an Admin's Accept or Suspend, and Mate uses none of its repositories
 * meanwhile. A bot nobody set up is used for nothing until an Owner or Admin removes it and adds
 * it again.
 *
 * *Add a GitHub account* is the one press, and which bot the account goes on is decided, never
 * asked (`addingApp`): the one the person set up, else the organization's; with none of its own
 * it opens the form that makes one from HQ's manifest — GitHub's own "new app" page in this tab,
 * back here after (`?github=connected`) — which never replaces another. *Add another bot* opens
 * that form outright.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  shownCanonicalHqListNavigationAtom,
  type TaskSourceSettingValue,
} from "@t3tools/client-runtime/data";
import type { HqGithubManifestRequest, HqGithubManifestView } from "@t3tools/shared/hqGithub";
import { GithubIcon, MoreHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { appBasePath } from "~/basePath";
import { useGithubApp } from "~/zerops/useTaskSourceSettings";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button, InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { OutLink, settingDay } from "./automationParts";
import { ConnectCard, ConnectStep, KeyField } from "./ConnectFlow";
import {
  addingApp,
  appNameProblem,
  appOwner,
  appSetUpWords,
  defaultAppName,
  GITHUB_ONE_LINE,
  GITHUB_WHO_CAN,
  githubConnected,
  githubInstallReturnTo,
  type GithubAppRow,
  githubReturnLine,
  githubReturnTo,
  type GithubReturn,
  githubSection,
  githubStatus,
  type NameOf,
  NEEDS_REMAKE,
  NOBODY_NAMED,
  postManifest,
} from "./automationSettings.logic";
import { IntegrationRow } from "./IntegrationRow";
import { searchableSetting } from "./settingsSearch";
import { taskSourceProblem, workingWords } from "./taskSourcesSettings.logic";

export interface GithubAppControls {
  readonly read: TaskSourceSettingValue<"hqGithub">;
  /** Reads the apps again, where HQ's answer failed. */
  readonly again: () => void;
  readonly manifest: (request: HqGithubManifestRequest) => Promise<HqGithubManifestView | null>;
  /** GitHub's install page for an app, with a one-time state from HQ, or `null` where HQ refused. */
  readonly install: (githubAppId: number, returnTo: string) => Promise<string | null>;
  /** HQ forgets an app and its installations. */
  readonly forget: (githubAppId: number) => void;
  /** Mate acts on a waiting installation's repositories. */
  readonly accept: (installationId: number) => void;
  /** GitHub suspends an installation. */
  readonly suspend: (installationId: number) => void;
  /** GitHub resumes an installation an app suspended. */
  readonly resume: (installationId: number) => void;
}

/** An HQ application's name by its id, as HQ's structure names it. */
export type ApplicationNameOf = (applicationId: string) => string | undefined;
const NO_APPLICATIONS: ApplicationNameOf = () => undefined;

export function GithubAppSettings({
  admin,
  returned,
  returnedApp = null,
}: {
  readonly admin: boolean;
  /** How GitHub brought the person back here, if it did. */
  readonly returned: GithubReturn;
  /** The app whose install trip brought the person back, if one did. */
  readonly returnedApp?: number | null;
}) {
  const { read, write, manifest, install, again, forget } = useGithubApp();
  const { activeOrganization, user } = useZeropsSession();
  const nameOf = usePersonNames(activeOrganization?.id);
  const navigation = useAtomValue(shownCanonicalHqListNavigationAtom);
  const applicationOf = useCallback<ApplicationNameOf>(
    (applicationId) => navigation.structure?.apps.find((app) => app.id === applicationId)?.name,
    [navigation],
  );
  return (
    <GithubAppView
      admin={admin}
      applicationOf={applicationOf}
      nameOf={nameOf}
      controls={{
        read,
        manifest,
        install,
        again,
        forget,
        accept: (installationId) => {
          write({ kind: "github-accept", installationId });
        },
        suspend: (installationId) => {
          write({ kind: "github-suspend", installationId });
        },
        resume: (installationId) => {
          write({ kind: "github-resume", installationId });
        },
      }}
      onOpen={(url) => {
        window.location.assign(url);
      }}
      onPost={(view) => {
        postManifest(document, view);
      }}
      organization={activeOrganization?.name ?? null}
      returnTo={githubReturnTo(window.location.origin, appBasePath())}
      returned={returned}
      returnedApp={returnedApp}
      viewerId={user?.id ?? null}
    />
  );
}

/** The press under way, and the bot it is for: its words show on that bot's group alone. */
interface Pressed {
  readonly appId: number;
  readonly verb: "github-install" | "github-forget" | "github-resume";
}

export function GithubAppView({
  controls,
  admin,
  organization,
  returnTo,
  returned,
  returnedApp = null,
  onPost,
  onOpen,
  viewerId = null,
  nameOf = NOBODY_NAMED,
  applicationOf = NO_APPLICATIONS,
  defaultCreating = false,
  defaultRemoving = null,
}: {
  readonly controls: GithubAppControls;
  /** The create form opened from the start: the harness's. */
  readonly defaultCreating?: boolean;
  /** The remove guard of this bot opened from the start: the harness's. */
  readonly defaultRemoving?: number | null;
  readonly admin: boolean;
  /** The Zerops organization's name: a new bot's first name, and what a bot is removed from. */
  readonly organization: string | null;
  readonly returnTo: string;
  readonly returned: GithubReturn;
  /** The bot whose install trip brought the person back, if one did. */
  readonly returnedApp?: number | null;
  /** Hands GitHub the manifest: the page leaves for GitHub's. */
  readonly onPost: (view: HqGithubManifestView) => void;
  /** Opens GitHub's install page in this tab: GitHub brings the person back here. */
  readonly onOpen: (url: string) => void;
  /** The person looking: *Add a GitHub account* uses the bot they set up, where they did. */
  readonly viewerId?: string | null;
  /** A member's name by Zerops user id, as the organization's member list names them. */
  readonly nameOf?: NameOf;
  /** An HQ application's name by its id. */
  readonly applicationOf?: ApplicationNameOf;
}) {
  const { read } = controls;
  const section = githubSection(read.setting, admin);
  const [creating, setCreating] = useState(defaultCreating);
  const [removing, setRemoving] = useState<number | null>(defaultRemoving);
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const working = read.action.kind === "working";
  /** The words of a press under way on this bot, else `null`. */
  const underWay = (appId: number): string | null =>
    read.action.kind === "working" && pressed?.appId === appId && read.action.verb === pressed.verb
      ? workingWords(pressed.verb)
      : null;
  const problem = taskSourceProblem(read.action);
  const back = githubReturnLine(returned, section, returnedApp);
  const apps = section.kind === "apps" ? section.apps : [];
  const manage = section.kind === "apps" && section.manage;
  const connected = read.setting.state === "known" && githubConnected(read.setting.held);
  const install = (appId: number) => {
    setPressed({ appId, verb: "github-install" });
    void controls.install(appId, githubInstallReturnTo(returnTo, appId)).then((url) => {
      if (url !== null) onOpen(url);
    });
  };
  // Which bot a new account goes on is decided here, never asked: no bot of the organization's
  // own, and the press makes it first.
  const adding = addingApp(apps, viewerId);
  // One line, whatever lands: a refusal, the return from GitHub, or where it stands.
  const line =
    problem !== null ? (
      <span className="text-destructive-foreground" role="alert">
        {problem}
      </span>
    ) : back !== null ? (
      <span role="status">{back}</span>
    ) : section.kind === "reading" || (section.kind === "apps" && apps.length === 0 && manage) ? (
      GITHUB_ONE_LINE
    ) : (
      githubStatus(section)
    );
  return (
    <IntegrationRow
      action={
        section.kind === "failed" ? (
          <Button onClick={controls.again} size="sm" variant="secondary">
            Try again
          </Button>
        ) : undefined
      }
      id={searchableSetting("automation-github").id}
      line={line}
      mark={<GithubIcon className="size-5" />}
      name="GitHub"
      open={section.kind === "apps" && (apps.length > 0 || manage)}
      state={
        section.kind === "reading"
          ? { kind: "checking" }
          : section.kind !== "apps"
            ? { kind: "none" }
            : connected
              ? { kind: "on", words: "Connected" }
              : apps.length > 0 && apps.every((app) => app.seal.kind === "needed")
                ? { kind: "off", words: "Not in use" }
                : { kind: "off", words: "Not connected" }
      }
      surface="settings-github"
    >
      {section.kind === "apps" ? (
        <>
          {apps.length === 0 ? null : (
            <ul className="grid gap-5" data-zerops-surface="settings-github-apps">
              {apps.map((app) => (
                <BotGroup
                  app={app}
                  applicationOf={applicationOf}
                  busy={working}
                  key={app.appId}
                  manage={manage}
                  nameOf={nameOf}
                  onAccept={controls.accept}
                  onCancelRemove={() => {
                    setRemoving(null);
                  }}
                  onInstall={() => {
                    install(app.appId);
                  }}
                  onRemove={() => {
                    setPressed({ appId: app.appId, verb: "github-forget" });
                    setRemoving(null);
                    controls.forget(app.appId);
                  }}
                  onResume={(installationId) => {
                    setPressed({ appId: app.appId, verb: "github-resume" });
                    controls.resume(installationId);
                  }}
                  onStartRemove={() => {
                    setRemoving(app.appId);
                    setCreating(false);
                  }}
                  onSuspend={controls.suspend}
                  organization={organization}
                  removing={removing === app.appId}
                  underWay={underWay(app.appId)}
                />
              ))}
            </ul>
          )}
          {!manage ? null : creating ? (
            <CreateApp
              busy={working}
              first={apps.length === 0}
              onCancel={() => {
                setCreating(false);
              }}
              onCreate={async (request) => {
                const view = await controls.manifest(request);
                if (view !== null) onPost(view);
                return view !== null;
              }}
              organization={organization}
              returnTo={returnTo}
              taken={apps.map((app) => app.name)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button
                disabled={working}
                onClick={() => {
                  setRemoving(null);
                  if (adding === null) setCreating(true);
                  else install(adding.appId);
                }}
                size="sm"
                variant={apps.length === 0 ? "primary" : "secondary"}
              >
                {adding !== null &&
                underWay(adding.appId) !== null &&
                pressed?.verb === "github-install"
                  ? "Opening GitHub…"
                  : "Add a GitHub account"}
              </Button>
              {apps.length === 0 ? null : (
                <span className="text-xs">
                  <InlineButton
                    disabled={working}
                    onClick={() => {
                      setCreating(true);
                      setRemoving(null);
                    }}
                    tone="muted"
                  >
                    Add another bot
                  </InlineButton>
                </span>
              )}
            </div>
          )}
          {apps.length > 0 && !manage ? (
            <p className="text-xs text-muted-foreground">{GITHUB_WHO_CAN}</p>
          ) : null}
        </>
      ) : null}
    </IntegrationRow>
  );
}

/** An account's face on GitHub: an organization's is a rounded square, a person's a circle. */
function AccountFace({
  account,
  type,
}: {
  readonly account: string | null;
  readonly type: "Organization" | "User" | null;
}) {
  const shape = type === "User" ? "rounded-full" : "rounded-md";
  return account === null ? (
    <span aria-hidden className={`size-5 shrink-0 bg-muted ${shape}`} />
  ) : (
    <img
      alt=""
      className={`size-5 shrink-0 bg-muted ${shape}`}
      height={20}
      src={`https://github.com/${encodeURIComponent(account)}.png?size=40`}
      width={20}
    />
  );
}

/**
 * One bot and the GitHub accounts Mate works in through it. The accounts are the rows — what
 * people come here for: each its name, what Mate may use there and how much of it is connected,
 * and the way to its repositories on GitHub. The bot is one quiet line over them: its name, the
 * login it writes as, whose it is where it is a person's own, who set it up; what is done to the
 * bot itself is behind its menu. An account waiting for an OK is a row among them, in the
 * attention tone, with its two answers.
 */
function BotGroup({
  app,
  manage,
  busy,
  removing,
  organization,
  nameOf,
  applicationOf,
  underWay,
  onInstall,
  onStartRemove,
  onCancelRemove,
  onRemove,
  onAccept,
  onSuspend,
  onResume,
}: {
  readonly app: GithubAppRow;
  /** This person may add accounts, judge what waits, or remove. */
  readonly manage: boolean;
  readonly busy: boolean;
  /** Its remove guard is open. */
  readonly removing: boolean;
  readonly organization: string | null;
  readonly nameOf: NameOf;
  readonly applicationOf: ApplicationNameOf;
  /** A press under way on this bot, in its words; `null` when none is. */
  readonly underWay: string | null;
  readonly onInstall: () => void;
  readonly onStartRemove: () => void;
  readonly onCancelRemove: () => void;
  readonly onRemove: () => void;
  readonly onAccept: (installationId: number) => void;
  readonly onSuspend: (installationId: number) => void;
  readonly onResume: (installationId: number) => void;
}) {
  const setUp = appSetUpWords(app.seal, nameOf, settingDay);
  const unsealed = app.seal.kind === "needed";
  const rows = app.installations.length + app.waiting.length;
  return (
    <li className="grid gap-1.5" data-zerops-surface="settings-github-app">
      <div className="flex min-h-7 items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{app.name}</span> · {app.botLogin}
          {app.personal ? (
            <>
              {" · "}
              <span className="text-status-attention-text">
                on {app.owner}'s own account: it leaves with them
              </span>
            </>
          ) : null}
          {setUp === null ? null : ` · ${setUp}`}
        </p>
        {underWay === null ? null : (
          <span className="shrink-0 text-xs text-muted-foreground" role="status">
            {underWay}
          </span>
        )}
        {manage ? (
          // The dots end where the rows' links do: the press's own inset is taken back.
          <span className="-me-1.5 flex shrink-0">
            <Menu>
              <MenuTrigger
                aria-label={`More for ${app.name}`}
                render={<Button size="icon-sm" variant="ghost" />}
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end" className="min-w-56">
                <MenuItem disabled={busy || unsealed} onClick={onInstall}>
                  Add an account with this bot
                </MenuItem>
                <MenuItem render={<a href={app.appUrl} rel="noreferrer" target="_blank" />}>
                  Open the bot on GitHub ↗
                </MenuItem>
                <MenuSeparator />
                <MenuItem disabled={busy} onClick={onStartRemove} variant="destructive">
                  Remove…
                </MenuItem>
              </MenuPopup>
            </Menu>
          </span>
        ) : (
          <span className="shrink-0 text-xs">
            <OutLink href={app.appUrl}>The bot on GitHub</OutLink>
          </span>
        )}
      </div>
      {unsealed ? (
        <p className="text-xs text-foreground" data-zerops-surface="settings-github-unsealed">
          {NEEDS_REMAKE}
        </p>
      ) : null}
      {rows === 0 ? (
        <p className="border-y border-border py-2 text-xs text-muted-foreground">
          No GitHub account added yet.
        </p>
      ) : (
        <ul
          className="divide-y divide-border border-y border-border"
          data-zerops-surface="settings-github-installations"
        >
          {app.installations.map((installation) => {
            const by = installation.addedBy === null ? undefined : nameOf(installation.addedBy);
            return (
              <li
                className="flex items-center gap-2.5 py-2 text-xs max-sm:flex-wrap"
                key={installation.id}
              >
                <AccountFace account={installation.account} type={installation.accountType} />
                <span className="font-medium text-sm text-foreground max-sm:min-w-0 max-sm:flex-1">
                  {installation.account ?? `Installation ${String(installation.id)}`}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground max-sm:order-last max-sm:w-full max-sm:flex-none max-sm:ps-7.5">
                  {installation.line}
                  {by === undefined ? null : ` · added by ${by}`}
                </span>
                {installation.suspended && manage ? (
                  <InlineButton
                    disabled={busy}
                    onClick={() => {
                      onResume(installation.id);
                    }}
                  >
                    Resume
                  </InlineButton>
                ) : null}
                {installation.manageUrl === null ? null : (
                  <OutLink href={installation.manageUrl}>Repositories</OutLink>
                )}
              </li>
            );
          })}
          {app.waiting.map((installation) => (
            <li
              className="grid gap-0.5 py-2 text-xs"
              data-zerops-surface="settings-github-waiting"
              key={installation.id}
            >
              <span className="flex items-center gap-2.5 max-sm:flex-wrap">
                <AccountFace account={installation.account} type={installation.accountType} />
                <span className="font-medium text-sm text-foreground max-sm:min-w-0 max-sm:flex-1">
                  {installation.account}
                </span>
                <span className="min-w-0 flex-1 text-status-attention-text max-sm:order-last max-sm:w-full max-sm:flex-none max-sm:ps-7.5">
                  {manage ? "Waits for your OK" : "Waits for an Owner's or Admin's OK"}
                </span>
                {manage ? (
                  <>
                    <InlineButton
                      disabled={busy}
                      onClick={() => {
                        onAccept(installation.id);
                      }}
                    >
                      Accept
                    </InlineButton>
                    <InlineButton
                      disabled={busy}
                      onClick={() => {
                        onSuspend(installation.id);
                      }}
                      tone="destructive"
                    >
                      Suspend
                    </InlineButton>
                  </>
                ) : null}
              </span>
              <span className="ps-7.5 text-muted-foreground">
                {installation.repositories.length === 0
                  ? "No repositories"
                  : installation.repositories.join(", ")}
                {manage
                  ? " · Mate uses none of it until you accept. Suspend stops Mate there on GitHub."
                  : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {app.privateTo === null ? null : (
        <p className="text-xs text-muted-foreground">
          This bot can only be added to {app.privateTo.owner}. To add other GitHub accounts,{" "}
          {app.privateTo.settings ? (
            <>
              <OutLink href={app.privateTo.url}>make it public on GitHub</OutLink>.
            </>
          ) : (
            <>
              its owner makes it public in its settings on GitHub, under Advanced:{" "}
              <OutLink href={app.privateTo.url}>the bot on GitHub</OutLink>.
            </>
          )}
        </p>
      )}
      {removing ? (
        <div
          className="grid gap-2 rounded-md bg-muted/40 p-3"
          data-zerops-surface="settings-github-remove"
          role="group"
        >
          <p className="text-sm font-medium text-foreground">
            Remove {app.name} from {organization ?? "this organization"}?
          </p>
          {app.uses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No repository in Mate is connected through it.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                These stop until they're connected through another bot or a token:
              </p>
              <ul className="grid gap-1 text-xs">
                {app.uses.map((use) => (
                  <li
                    className="text-foreground"
                    key={`${use.application ?? ""}/${use.repo ?? use.fullName}`}
                  >
                    {use.application === null || use.repo === null
                      ? "A project you can't open"
                      : `${applicationOf(use.application) ?? "Another project"} · ${use.repo}`}{" "}
                    → <span className="font-mono">{use.fullName}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            The bot stays on GitHub: delete it in its settings there.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={onRemove} size="sm" variant="destructive">
              Remove bot
            </Button>
            <Button onClick={onCancelRemove} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function CreateApp({
  organization,
  taken,
  returnTo,
  busy,
  first,
  onCancel,
  onCreate,
}: {
  readonly organization: string | null;
  /** The names of the organization's bots: the first name offered is none of them. */
  readonly taken: ReadonlyArray<string>;
  readonly returnTo: string;
  readonly busy: boolean;
  /** The organization has no bot yet: this makes its first, and adds its first account. */
  readonly first: boolean;
  readonly onCancel: () => void;
  /** Whether GitHub's page takes over: false where HQ refused. */
  readonly onCreate: (request: HqGithubManifestRequest) => Promise<boolean>;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(() => defaultAppName(organization, taken));
  const [refusal, setRefusal] = useState<string | null>(null);
  // Pressed and GitHub's page not yet here: the press says so until the browser leaves.
  const [leaving, setLeaving] = useState(false);
  // Back from GitHub's page restores this one from the browser's cache, mid-press: it is
  // pressable again once the page shows, or comes back into view.
  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    const seen = () => {
      if (document.visibilityState === "visible") setLeaving(false);
    };
    window.addEventListener("pageshow", back);
    document.addEventListener("visibilitychange", seen);
    return () => {
      window.removeEventListener("pageshow", back);
      document.removeEventListener("visibilitychange", seen);
    };
  }, []);
  return (
    <ConnectCard
      busy={busy || leaving}
      note={
        first
          ? "GitHub brings you back here once the bot is made and its first account is added."
          : "GitHub brings you back here once it is made. The organization's other bots stay as they are."
      }
      onCancel={onCancel}
      onSubmit={() => {
        const problem = appNameProblem(name);
        setRefusal(problem);
        if (problem !== null) return;
        setLeaving(true);
        void onCreate({ owner: appOwner(owner), name: name.trim(), returnTo }).then((left) => {
          if (!left) setLeaving(false);
        });
      }}
      ready
      submit={leaving ? "Opening GitHub…" : "Continue on GitHub"}
    >
      <ConnectStep
        help="Mate works on GitHub as a bot. People see its name on everything Mate writes there."
        n={1}
        title={first ? "Name Mate's bot" : "Name the new bot"}
      >
        <KeyField
          autoFocus
          hint="Up to 34 characters."
          label="Bot name"
          maxLength={34}
          onChange={setName}
          problem={refusal}
          value={name}
        />
        <KeyField
          hint="The GitHub organization the bot belongs to, or empty for your own account. A bot on your own account goes with you if you leave."
          label="GitHub organization"
          onChange={setOwner}
          placeholder="Your own account"
          value={owner}
        />
      </ConnectStep>
      <ConnectStep
        help="Press Create GitHub App on GitHub's page, then pick the account and the repositories Mate may use."
        n={2}
        title="Finish on GitHub"
      />
    </ConnectCard>
  );
}
