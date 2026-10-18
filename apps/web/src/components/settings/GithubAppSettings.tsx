/**
 * Settings › Automation › GitHub: the organization's own GitHub app, which everything Mate writes
 * on GitHub comes from. Not connected, the Owner and Admins make it in two fields and one press —
 * HQ's manifest goes to GitHub's own "new app" page in this tab, and GitHub brings the person back
 * here (`?github=connected`). Connected, it says the bot it writes as and where it is installed,
 * each with its page on GitHub; *Disconnect* makes HQ forget it, after saying the app stays on
 * GitHub to delete there.
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
}

export function GithubAppSettings({
  admin,
  returned,
}: {
  readonly admin: boolean;
  /** How GitHub brought the person back here, if it did. */
  readonly returned: GithubReturn;
}) {
  const { read, write, manifest, again } = useGithubApp();
  const { activeOrganization } = useZeropsSession();
  return (
    <GithubAppView
      admin={admin}
      controls={{
        read,
        manifest,
        again,
        disconnect: () => {
          write({ kind: "github-disconnect" });
        },
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
              </li>
            ))}
          </ul>
          {section.manage ? (
            <div className="flex items-center gap-4 text-xs">
              <OutLink href={section.installUrl}>
                {section.installations.length === 0
                  ? "Install it on repositories"
                  : "Install on more repositories"}
              </OutLink>
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
