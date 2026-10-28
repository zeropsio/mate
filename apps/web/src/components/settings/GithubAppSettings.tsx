/**
 * Settings › Automation › GitHub: the organization's own GitHub app, which everything Mate writes
 * on GitHub comes from. Not connected, the Owner and Admins make it in two fields and one press —
 * HQ's manifest goes to GitHub's own "new app" page in this tab, and GitHub brings the person back
 * here (`?github=connected`). Connected, it says the bot it writes as and each account it is
 * installed on, with its page on GitHub. The app is public, so people install it on their own
 * accounts and organizations too: one installed from here comes back accepted, any other waits
 * apart for the Owner's or an Admin's Accept or Suspend, and Mate acts on none of its repositories
 * meanwhile. A private app says it installs only on its owner, and where to make it public.
 * *Disconnect* makes HQ forget it, after saying the app stays on GitHub to delete there.
 */
import type { TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqGithubManifestRequest, HqGithubManifestView } from "@t3tools/shared/hqGithub";
import { GithubIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { appBasePath } from "~/basePath";
import { useGithubApp } from "~/zerops/useTaskSourceSettings";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button, InlineButton } from "../ui/button";
import { OutLink } from "./automationParts";
import { ConnectCard, ConnectStep, KeyField } from "./ConnectFlow";
import {
  appNameProblem,
  appOwner,
  defaultAppName,
  GITHUB_ONE_LINE,
  githubReturnLine,
  githubReturnTo,
  type GithubReturn,
  githubSection,
  githubStatus,
  postManifest,
} from "./automationSettings.logic";
import { IntegrationAction, IntegrationRow } from "./IntegrationRow";
import { searchableSetting } from "./settingsSearch";
import { taskSourceProblem, workingWords } from "./taskSourcesSettings.logic";

export interface GithubAppControls {
  readonly read: TaskSourceSettingValue<"hqGithub">;
  readonly disconnect: () => void;
  /** Reads the app again, where HQ's answer failed. */
  readonly again: () => void;
  readonly manifest: (request: HqGithubManifestRequest) => Promise<HqGithubManifestView | null>;
  /** GitHub's install page with a one-time state from HQ, or `null` where HQ refused. */
  readonly install: (returnTo: string) => Promise<string | null>;
  /** Mate acts on a waiting installation's repositories. */
  readonly accept: (installationId: number) => void;
  /** GitHub suspends an installation. */
  readonly suspend: (installationId: number) => void;
  /** GitHub resumes an installation the app suspended. */
  readonly resume: (installationId: number) => void;
}

const INSTALL_FURTHER = "Install on another GitHub account or more repositories";

export function GithubAppSettings({
  admin,
  returned,
}: {
  readonly admin: boolean;
  /** How GitHub brought the person back here, if it did. */
  readonly returned: GithubReturn;
}) {
  const { read, write, manifest, install, again } = useGithubApp();
  const { activeOrganization } = useZeropsSession();
  return (
    <GithubAppView
      admin={admin}
      controls={{
        read,
        manifest,
        install,
        again,
        disconnect: () => {
          write({ kind: "github-disconnect" });
        },
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
    />
  );
}

export function GithubAppView({
  controls,
  admin,
  organization,
  returnTo,
  returned,
  onPost,
  onOpen,
  defaultOpen = false,
}: {
  readonly controls: GithubAppControls;
  /** Its press's part opened from the start: the harness's. */
  readonly defaultOpen?: boolean;
  readonly admin: boolean;
  /** The Zerops organization's name: the app's first name. */
  readonly organization: string | null;
  readonly returnTo: string;
  readonly returned: GithubReturn;
  /** Hands GitHub the manifest: the page leaves for GitHub's. */
  readonly onPost: (view: HqGithubManifestView) => void;
  /** Opens GitHub's install page in this tab: GitHub brings the person back here. */
  readonly onOpen: (url: string) => void;
}) {
  const { read } = controls;
  const section = githubSection(read.setting, admin);
  const [open, setOpen] = useState(defaultOpen);
  const [confirming, setConfirming] = useState(false);
  const working = read.action.kind === "working";
  const problem = taskSourceProblem(read.action);
  const back = githubReturnLine(returned, section);
  const toggle = () => {
    setOpen((was) => !was);
    setConfirming(false);
  };
  // One line, whatever lands: a refusal, the return from GitHub, or where it stands.
  const line =
    problem !== null ? (
      <span className="text-destructive-foreground" role="alert">
        {problem}
      </span>
    ) : back !== null ? (
      <span role="status">{back}</span>
    ) : section.kind === "connected" ? (
      <>
        Connected as <span className="font-mono text-foreground">{section.botLogin}</span>
        {section.installations.length === 0
          ? " · installed nowhere yet"
          : ` · ${section.installations.map((installation) => installation.line).join(", ")}`}
        {section.waiting.length === 0 ? null : ` · ${section.waiting.length} waiting for an OK`}
      </>
    ) : section.kind === "none" ? (
      section.connect ? (
        GITHUB_ONE_LINE
      ) : (
        "The organization's Owner and Admins connect it."
      )
    ) : section.kind === "reading" ? (
      GITHUB_ONE_LINE
    ) : (
      githubStatus(section)
    );
  return (
    <IntegrationRow
      action={
        section.kind === "none" && section.connect ? (
          <IntegrationAction closeWords={null} onToggle={toggle} open={open} primary>
            Connect
          </IntegrationAction>
        ) : section.kind === "connected" ? (
          <IntegrationAction closeWords="Close" onToggle={toggle} open={open} primary={false}>
            Manage
          </IntegrationAction>
        ) : section.kind === "failed" ? (
          <Button onClick={controls.again} size="sm" variant="secondary">
            Read again
          </Button>
        ) : undefined
      }
      id={searchableSetting("automation-github").id}
      line={line}
      mark={<GithubIcon className="size-5" />}
      name="GitHub"
      open={open && (section.kind === "connected" || (section.kind === "none" && section.connect))}
      state={
        section.kind === "reading"
          ? { kind: "checking" }
          : section.kind === "connected"
            ? { kind: "on", words: "Connected" }
            : section.kind === "none"
              ? { kind: "off", words: "Not connected" }
              : { kind: "none" }
      }
      surface="settings-github"
    >
      {section.kind === "none" ? (
        <CreateApp
          busy={working}
          onCancel={() => {
            setOpen(false);
          }}
          onCreate={async (request) => {
            const view = await controls.manifest(request);
            if (view !== null) onPost(view);
            return view !== null;
          }}
          organization={organization}
          returnTo={returnTo}
        />
      ) : section.kind === "connected" ? (
        <>
          <ul className="grid gap-1.5" data-zerops-surface="settings-github-installations">
            {section.installations.map((installation) => (
              <li className="flex items-center gap-1.5 text-xs" key={installation.id}>
                <span className="text-foreground">{installation.line}</span>
                <span className="text-muted-foreground">·</span>
                <OutLink href={installation.manageUrl}>Manage on GitHub</OutLink>
                {installation.suspended && section.manage && section.installTrip ? (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <InlineButton
                      disabled={working}
                      onClick={() => {
                        controls.resume(installation.id);
                      }}
                    >
                      {read.action.kind === "working" && read.action.verb === "github-resume"
                        ? workingWords("github-resume")
                        : "Resume"}
                    </InlineButton>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {section.privateTo === null ? null : (
            <p className="text-xs text-muted-foreground">
              This app can only be installed on {section.privateTo.owner}. To add other GitHub
              accounts,{" "}
              {section.privateTo.settings ? (
                <>
                  <OutLink href={section.privateTo.url}>make it public on GitHub</OutLink>.
                </>
              ) : (
                <>
                  its owner makes it public in the app's settings on GitHub, under Advanced:{" "}
                  <OutLink href={section.privateTo.url}>the app on GitHub</OutLink>.
                </>
              )}
            </p>
          )}
          {section.waiting.length === 0 ? null : (
            <div className="grid gap-1.5" data-zerops-surface="settings-github-waiting">
              <p className="text-xs font-medium text-foreground">
                {section.manage ? "Waiting for your OK" : "Waiting for an admin's OK"}
              </p>
              <ul className="grid gap-1.5">
                {section.waiting.map((installation) => (
                  <li className="grid gap-0.5 text-xs" key={installation.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="text-foreground">{installation.account}</span>
                      {section.manage ? (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <InlineButton
                            disabled={working}
                            onClick={() => {
                              controls.accept(installation.id);
                            }}
                          >
                            Accept
                          </InlineButton>
                          <InlineButton
                            disabled={working}
                            onClick={() => {
                              controls.suspend(installation.id);
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
              {section.manage ? (
                <p className="text-xs text-muted-foreground">
                  Mate uses none of these repositories until you accept. Suspend stops the app there
                  on GitHub.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Organization admins and the owner can change this.
                </p>
              )}
            </div>
          )}
          {section.manage ? (
            <div className="flex items-center gap-4 text-xs">
              {section.installTrip ? (
                <InlineButton
                  disabled={working}
                  onClick={() => {
                    void controls.install(returnTo).then((url) => {
                      if (url !== null) onOpen(url);
                    });
                  }}
                >
                  {read.action.kind === "working" && read.action.verb === "github-install"
                    ? workingWords("github-install")
                    : INSTALL_FURTHER}
                </InlineButton>
              ) : (
                // An HQ before install trips: GitHub's own page, as it always was.
                <OutLink href={section.installUrl}>{INSTALL_FURTHER}</OutLink>
              )}
              {confirming ? null : (
                <InlineButton
                  disabled={working}
                  onClick={() => {
                    setConfirming(true);
                  }}
                  tone="destructive"
                >
                  {read.action.kind === "working" && read.action.verb === "github-disconnect"
                    ? workingWords("github-disconnect")
                    : "Disconnect"}
                </InlineButton>
              )}
            </div>
          ) : null}
          {confirming ? (
            <div className="grid gap-2" role="group">
              <p className="text-xs text-foreground">
                HQ forgets the app, and Mate stops acting on GitHub through it. Repositories
                mirrored through it stop mirroring, and their changes stop updating on GitHub. The
                app stays on GitHub: delete it in its settings there.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setConfirming(false);
                    setOpen(false);
                    controls.disconnect();
                  }}
                  size="sm"
                  variant="destructive"
                >
                  Disconnect
                </Button>
                <Button
                  onClick={() => {
                    setConfirming(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </IntegrationRow>
  );
}

function CreateApp({
  organization,
  returnTo,
  busy,
  onCancel,
  onCreate,
}: {
  readonly organization: string | null;
  readonly returnTo: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  /** Whether GitHub's page takes over: false where HQ refused. */
  readonly onCreate: (request: HqGithubManifestRequest) => Promise<boolean>;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(() => defaultAppName(organization));
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
      note="GitHub brings you back here once the app is made."
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
          hint="The GitHub organization the app belongs to. Leave it empty for your own account."
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
