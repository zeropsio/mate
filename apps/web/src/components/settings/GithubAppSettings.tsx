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
import { useId, useState } from "react";

import { appBasePath } from "~/basePath";
import { useGithubApp } from "~/zerops/useTaskSourceSettings";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { OutLink } from "./automationParts";
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
  const { read, write, manifest } = useGithubApp();
  const { activeOrganization } = useZeropsSession();
  return (
    <GithubAppView
      admin={admin}
      controls={{
        read,
        manifest,
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
          <IntegrationAction onToggle={toggle} open={open} primary>
            Connect
          </IntegrationAction>
        ) : section.kind === "connected" ? (
          <IntegrationAction closeWords="Close" onToggle={toggle} open={open} primary={false}>
            Manage
          </IntegrationAction>
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
  onCreate,
}: {
  readonly organization: string | null;
  readonly returnTo: string;
  readonly busy: boolean;
  /** Whether GitHub's page takes over: false where HQ refused. */
  readonly onCreate: (request: HqGithubManifestRequest) => Promise<boolean>;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(() => defaultAppName(organization));
  const [refusal, setRefusal] = useState<string | null>(null);
  // Pressed and GitHub's page not yet here: the press says so until the browser leaves.
  const [leaving, setLeaving] = useState(false);
  const ownerId = useId();
  const nameId = useId();
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = appNameProblem(name);
        setRefusal(problem);
        if (problem !== null || leaving) return;
        setLeaving(true);
        void onCreate({ owner: appOwner(owner), name: name.trim(), returnTo }).then((left) => {
          if (!left) setLeaving(false);
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor={ownerId}>GitHub organization</Label>
          <Input
            aria-describedby={`${ownerId}-hint`}
            autoComplete="off"
            id={ownerId}
            onChange={(event) => {
              setOwner(event.target.value);
            }}
            placeholder="Your own account"
            size="sm"
            spellCheck={false}
            value={owner}
          />
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor={nameId}>App name</Label>
          <Input
            autoComplete="off"
            id={nameId}
            maxLength={34}
            onChange={(event) => {
              setName(event.target.value);
            }}
            size="sm"
            spellCheck={false}
            value={name}
          />
        </div>
        <Button disabled={busy || leaving} size="sm" type="submit">
          {leaving ? "Opening GitHub…" : "Create GitHub app"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" id={`${ownerId}-hint`}>
        GitHub asks you to confirm the app, then which repositories it may reach.
      </p>
      {refusal === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {refusal}
        </p>
      )}
    </form>
  );
}
