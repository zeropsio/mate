/**
 * Settings › Automation › GitHub: the organization's GitHub apps, which everything Mate writes on
 * GitHub comes from. Each app is a row: its name, whose GitHub account owns it (a person's account
 * is tagged: the app goes with them if they leave), who set it up and when, where it is installed,
 * how many Mate repositories go through it, and the bot it pushes as, with its page on GitHub.
 * Under it, each account it is installed on: one installed from here comes back accepted, any other
 * waits apart for the Owner's or an Admin's Accept or Suspend, and Mate acts on none of its
 * repositories meanwhile; *Add an account* starts HQ's install trip for that app. An app nobody
 * vouched for is used for nothing until an Owner or Admin presses *Confirm*. *Remove…* names every
 * Mate repository that stops before HQ forgets the app. *Add a GitHub app* makes another app from
 * HQ's manifest — GitHub's own "new app" page in this tab, back here after (`?github=connected`) —
 * and never replaces one.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  shownCanonicalHqListNavigationAtom,
  type TaskSourceSettingValue,
} from "@t3tools/client-runtime/data";
import type { HqGithubManifestRequest, HqGithubManifestView } from "@t3tools/shared/hqGithub";
import { GithubIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { appBasePath } from "~/basePath";
import { useGithubApp } from "~/zerops/useTaskSourceSettings";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { OutLink, settingDay } from "./automationParts";
import { ConnectCard, ConnectStep, KeyField } from "./ConnectFlow";
import {
  appNameProblem,
  appOwner,
  appReachLine,
  appSetUpWords,
  CONFIRM_WHO_CAN,
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
  NEEDS_CONFIRM,
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
  /** An Owner or Admin vouches for an app nobody sealed. */
  readonly confirm: (githubAppId: number) => void;
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
  const { read, write, manifest, install, again, forget, confirm } = useGithubApp();
  const { activeOrganization } = useZeropsSession();
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
        confirm,
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
    />
  );
}

/** The press under way, and the app it is for: its words show on that app's row alone. */
interface Pressed {
  readonly appId: number;
  readonly verb: "github-install" | "github-confirm" | "github-forget" | "github-resume";
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
  nameOf = NOBODY_NAMED,
  applicationOf = NO_APPLICATIONS,
  defaultCreating = false,
  defaultRemoving = null,
}: {
  readonly controls: GithubAppControls;
  /** The create form opened from the start: the harness's. */
  readonly defaultCreating?: boolean;
  /** The remove guard of this app opened from the start: the harness's. */
  readonly defaultRemoving?: number | null;
  readonly admin: boolean;
  /** The Zerops organization's name: a new app's first name, and what an app is removed from. */
  readonly organization: string | null;
  readonly returnTo: string;
  readonly returned: GithubReturn;
  /** The app whose install trip brought the person back, if one did. */
  readonly returnedApp?: number | null;
  /** Hands GitHub the manifest: the page leaves for GitHub's. */
  readonly onPost: (view: HqGithubManifestView) => void;
  /** Opens GitHub's install page in this tab: GitHub brings the person back here. */
  readonly onOpen: (url: string) => void;
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
  const wordsOf = (appId: number, verb: Pressed["verb"], idle: string) =>
    read.action.kind === "working" &&
    read.action.verb === verb &&
    pressed?.appId === appId &&
    pressed.verb === verb
      ? workingWords(verb)
      : idle;
  const problem = taskSourceProblem(read.action);
  const back = githubReturnLine(returned, section, returnedApp);
  const apps = section.kind === "apps" ? section.apps : [];
  const manage = section.kind === "apps" && section.manage;
  const connected = read.setting.state === "known" && githubConnected(read.setting.held);
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
            Read again
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
            <ul className="grid gap-2" data-zerops-surface="settings-github-apps">
              {apps.map((app) => (
                <AppRow
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
                  onConfirm={() => {
                    setPressed({ appId: app.appId, verb: "github-confirm" });
                    controls.confirm(app.appId);
                  }}
                  onInstall={() => {
                    setPressed({ appId: app.appId, verb: "github-install" });
                    void controls
                      .install(app.appId, githubInstallReturnTo(returnTo, app.appId))
                      .then((url) => {
                        if (url !== null) onOpen(url);
                      });
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
                  wordsOf={(verb, idle) => wordsOf(app.appId, verb, idle)}
                />
              ))}
            </ul>
          )}
          {!manage ? null : creating ? (
            <CreateApp
              busy={working}
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
            <div>
              <Button
                disabled={working}
                onClick={() => {
                  setCreating(true);
                  setRemoving(null);
                }}
                size="sm"
                variant={apps.length === 0 ? "primary" : "secondary"}
              >
                Add a GitHub app
              </Button>
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

function AppRow({
  app,
  manage,
  busy,
  removing,
  organization,
  nameOf,
  applicationOf,
  wordsOf,
  onConfirm,
  onInstall,
  onStartRemove,
  onCancelRemove,
  onRemove,
  onAccept,
  onSuspend,
  onResume,
}: {
  readonly app: GithubAppRow;
  /** This person may add accounts, confirm, judge what waits, or remove. */
  readonly manage: boolean;
  readonly busy: boolean;
  /** Its remove guard is open. */
  readonly removing: boolean;
  readonly organization: string | null;
  readonly nameOf: NameOf;
  readonly applicationOf: ApplicationNameOf;
  /** A press's words: its working words while it is this row's, else `idle`. */
  readonly wordsOf: (verb: Pressed["verb"], idle: string) => string;
  readonly onConfirm: () => void;
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
  return (
    <li
      className="grid gap-2 rounded-lg border border-border px-3 py-2.5"
      data-zerops-surface="settings-github-app"
    >
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-sm font-medium text-foreground">{app.name}</p>
          <p className="text-xs text-muted-foreground">
            Owned by <span className="font-mono text-foreground">{app.owner}</span>
            {app.personal ? ", a personal account" : null}
            {setUp === null ? null : ` · ${setUp}`}
          </p>
          <p className="text-xs text-muted-foreground">{appReachLine(app)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {app.personal ? <Badge tone="warning">Owned by a person</Badge> : null}
          <Button
            render={<a href={app.appUrl} rel="noreferrer" target="_blank" />}
            size="sm"
            variant="secondary"
          >
            Manage
          </Button>
        </div>
      </div>
      {unsealed ? (
        <div
          className="flex items-center gap-2 text-xs"
          data-zerops-surface="settings-github-confirm"
        >
          <span className="text-foreground">{NEEDS_CONFIRM}</span>
          {manage ? (
            <Button disabled={busy} onClick={onConfirm} size="sm">
              {wordsOf("github-confirm", "Confirm")}
            </Button>
          ) : (
            <span className="text-muted-foreground">{CONFIRM_WHO_CAN}</span>
          )}
        </div>
      ) : null}
      {app.installations.length === 0 ? null : (
        <ul className="grid gap-1" data-zerops-surface="settings-github-installations">
          {app.installations.map((installation) => (
            <li className="flex items-center gap-1.5 text-xs" key={installation.id}>
              <span className="text-foreground">{installation.line}</span>
              {installation.manageUrl === null ? null : (
                <>
                  <span className="text-muted-foreground">·</span>
                  <OutLink href={installation.manageUrl}>Repository access</OutLink>
                </>
              )}
              {installation.suspended && manage ? (
                <>
                  <span className="text-muted-foreground">·</span>
                  <InlineButton
                    disabled={busy}
                    onClick={() => {
                      onResume(installation.id);
                    }}
                  >
                    {wordsOf("github-resume", "Resume")}
                  </InlineButton>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {app.waiting.length === 0 ? null : (
        <div className="grid gap-1.5" data-zerops-surface="settings-github-waiting">
          <p className="text-xs font-medium text-foreground">
            {manage ? "Waiting for your OK" : "Waiting for an admin's OK"}
          </p>
          <ul className="grid gap-1.5">
            {app.waiting.map((installation) => (
              <li className="grid gap-0.5 text-xs" key={installation.id}>
                <span className="flex items-center gap-1.5">
                  <span className="text-foreground">{installation.account}</span>
                  {manage ? (
                    <>
                      <span className="text-muted-foreground">·</span>
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
                <span className="text-muted-foreground">
                  {installation.repositories.length === 0
                    ? "No repositories"
                    : installation.repositories.join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {manage
              ? "Mate uses none of these repositories until you accept. Suspend stops the app there on GitHub."
              : "Organization admins and the owner can change this."}
          </p>
        </div>
      )}
      {app.privateTo === null ? null : (
        <p className="text-xs text-muted-foreground">
          This app can only be installed on {app.privateTo.owner}. To add other GitHub accounts,{" "}
          {app.privateTo.settings ? (
            <>
              <OutLink href={app.privateTo.url}>make it public on GitHub</OutLink>.
            </>
          ) : (
            <>
              its owner makes it public in the app's settings on GitHub, under Advanced:{" "}
              <OutLink href={app.privateTo.url}>the app on GitHub</OutLink>.
            </>
          )}
        </p>
      )}
      {manage && !removing ? (
        <div className="flex items-center gap-4 text-xs">
          <InlineButton disabled={busy} onClick={onInstall}>
            {wordsOf("github-install", "Add an account")}
          </InlineButton>
          <InlineButton disabled={busy} onClick={onStartRemove} tone="destructive">
            {wordsOf("github-forget", "Remove…")}
          </InlineButton>
        </div>
      ) : null}
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
                These stop until they're connected through another app or a token:
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
            The app stays on GitHub: delete it in its settings there.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={onRemove} size="sm" variant="destructive">
              Remove app
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
  onCancel,
  onCreate,
}: {
  readonly organization: string | null;
  /** The names of the organization's apps: the first name offered is none of them. */
  readonly taken: ReadonlyArray<string>;
  readonly returnTo: string;
  readonly busy: boolean;
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
      note="GitHub brings you back here once the app is made. The organization's other apps stay as they are."
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
      submit={leaving ? "Opening GitHub…" : "Create GitHub app"}
    >
      <ConnectStep
        help="People see its name on everything Mate writes on GitHub."
        n={1}
        title="Name the app"
      >
        <KeyField
          autoFocus
          hint="The GitHub organization the app belongs to, or empty for your own account. An app on your own account goes with you if you leave."
          label="GitHub organization"
          onChange={setOwner}
          placeholder="Your own account"
          value={owner}
        />
        <KeyField
          hint="Up to 34 characters."
          label="App name"
          maxLength={34}
          onChange={setName}
          problem={refusal}
          value={name}
        />
      </ConnectStep>
      <ConnectStep
        help="GitHub asks you to confirm the app, then which repositories it may reach."
        n={2}
        title="Confirm it on GitHub"
      />
    </ConnectCard>
  );
}
