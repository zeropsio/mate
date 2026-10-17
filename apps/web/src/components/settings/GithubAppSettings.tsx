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
import { useId, useState } from "react";

import { appBasePath } from "~/basePath";
import { useGithubApp } from "~/zerops/useTaskSourceSettings";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { OutLink } from "./automationParts";
import {
  appNameProblem,
  appOwner,
  defaultAppName,
  GITHUB_ONE_LINE,
  githubReturnTo,
  githubSection,
  githubStatus,
  postManifest,
} from "./automationSettings.logic";
import { SettingsRow } from "./settingsLayout";
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
  /** GitHub brought the person back here once the app was made. */
  readonly returned: boolean;
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
}: {
  readonly controls: GithubAppControls;
  readonly admin: boolean;
  /** The Zerops organization's name: the app's first name. */
  readonly organization: string | null;
  readonly returnTo: string;
  readonly returned: boolean;
  /** Hands GitHub the manifest: the page leaves for GitHub's. */
  readonly onPost: (view: HqGithubManifestView) => void;
}) {
  const { read } = controls;
  const section = githubSection(read.setting, admin);
  const [confirming, setConfirming] = useState(false);
  const working = read.action.kind === "working";
  const problem = taskSourceProblem(read.action);
  return (
    <SettingsRow
      {...searchableSetting("automation-github")}
      control={
        section.kind === "connected" && section.manage && !confirming ? (
          <Button
            disabled={working}
            onClick={() => {
              setConfirming(true);
            }}
            size="sm"
            variant="ghost"
          >
            {working && read.action.kind === "working" && read.action.verb === "github-disconnect"
              ? workingWords("github-disconnect")
              : "Disconnect"}
          </Button>
        ) : undefined
      }
      data-zerops-surface="settings-github"
      description={GITHUB_ONE_LINE}
      status={
        section.kind === "connected" ? (
          <span>
            Connected as <span className="font-mono text-foreground">{section.botLogin}</span>
          </span>
        ) : (
          githubStatus(section)
        )
      }
    >
      {section.kind === "none" && section.connect ? (
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
        <div className="grid gap-2 px-3 pb-3">
          {returned ? (
            <p className="text-xs text-foreground" role="status">
              GitHub is connected. Mate acts there as {section.botLogin} from now on.
            </p>
          ) : null}
          <ul className="grid gap-1" data-zerops-surface="settings-github-installations">
            {section.installations.map((installation) => (
              <li className="flex items-center justify-between gap-3 text-xs" key={installation.id}>
                <span className="text-foreground">{installation.line}</span>
                <OutLink href={installation.manageUrl}>Manage on GitHub</OutLink>
              </li>
            ))}
          </ul>
          {section.manage ? (
            <p className="text-xs">
              <OutLink href={section.installUrl}>
                {section.installations.length === 0
                  ? "Install it on repositories"
                  : "Install on more repositories"}
              </OutLink>
            </p>
          ) : null}
          {confirming ? (
            <div className="grid gap-2 rounded-lg border border-border p-3" role="group">
              <p className="text-xs text-foreground">
                HQ forgets the app, and Mate stops acting on GitHub through it. The app stays on
                GitHub: delete it in its settings there.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setConfirming(false);
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
        </div>
      ) : null}
      {problem === null ? null : (
        <p className="px-3 pb-3 text-xs text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </SettingsRow>
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
      className="grid gap-2 px-3 pb-3"
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
