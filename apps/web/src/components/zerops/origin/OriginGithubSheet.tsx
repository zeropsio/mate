/**
 * Keeping an asked origin's code on GitHub: the asked repository's HQ repository mounts it through
 * the organization's GitHub app — what is missing first (the app, its reach of the repository, the
 * person's right), then, once HQ mounts it, whether GitHub lets only what Mate approved reach main.
 * No token is offered here.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { useState } from "react";

import { OutLink } from "../../settings/automationParts";
import { Button, InlineButton } from "../../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../../ui/dialog";
import { gitRemoteLabel } from "../GitDeliveryStatus";
import { githubName, mirrorGateLine, type GitMirrorApp, waitingWords } from "../gitMirror.logic";
import { GithubInstallOffer } from "../GithubInstallOffer";
import { type OriginAsk, originAddress, originMountStep } from "./originAsk.logic";

/** What the container reads and does for the GitHub way. */
export interface OriginGithubProps {
  /** The organization's GitHub app; `null` while read. */
  readonly app: GitMirrorApp | null;
  /** The Mate's application's repositories; `undefined` while HQ has not said. */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  /** HQ lets the person connect a repository of the application. */
  readonly mountable: boolean;
  /** HQ's words for why not, where it does not. */
  readonly refusal: string | undefined;
  /** Mounts the asked repository as the app names it (`owner/name`); `null` once HQ took it. */
  readonly onMount: (repository: string) => Promise<string | null>;
  /** Reads the app again, after the person changed it on GitHub. */
  readonly onCheckAgain: () => void;
  /** Opens Settings › Automation, where GitHub is connected. */
  readonly onOpenAutomation: () => void;
  /** The person is the organization's Owner or an Admin: they install through HQ's trip. */
  readonly admin: boolean;
  /** Leaves for GitHub's install page through HQ's trip, coming back here. */
  readonly onInstall: () => void;
}

export function OriginGithubSheet({
  ask,
  mateName,
  app,
  repos,
  mountable,
  refusal,
  onMount,
  onCheckAgain,
  onOpenAutomation,
  admin,
  onInstall,
  onClose,
}: OriginGithubProps & {
  readonly ask: Pick<OriginAsk, "url" | "repo">;
  readonly mateName: string;
  readonly onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Taken by HQ: the button waits until its record shows the mount.
  const [sent, setSent] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const step = originMountStep(ask, app, repos, mountable);
  const address = originAddress(ask.url);
  const mount = async (repository: string) => {
    setBusy(true);
    setAnswer(null);
    const refused = await onMount(repository);
    setBusy(false);
    setSent(refused === null);
    setAnswer(refused);
  };
  const gate =
    step.kind === "mounted" ? mirrorGateLine(step.remote, app ?? { kind: "unknown" }) : undefined;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Keep the code on GitHub</DialogTitle>
        <DialogDescription>
          {mateName} pushes its branches to {address} through your organization's GitHub app, and
          its changes open there for review. Main moves only by a merge.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="grid gap-2">
          {step.kind === "reading" ? (
            <p className="rv-note">Reading your organization's GitHub app…</p>
          ) : step.kind === "mounted" ? (
            <>
              <p className="rv-words">
                {ask.repo} keeps its code on {address}
                {app?.kind === "connected" ? ` through ${app.name}` : ""}.
              </p>
              {gate === undefined ? null : (
                <>
                  <p className="rv-note">{gate}</p>
                  <p className="rv-note">Mate checks GitHub's rules every minute.</p>
                </>
              )}
            </>
          ) : step.kind === "taken" ? (
            <p className="rv-note">
              {ask.repo} already keeps its code with {gitRemoteLabel(step.url)}. Change it in the
              project's Mirror code to GitHub or GitLab.
            </p>
          ) : step.kind === "refused" ? (
            <p className="rv-note">
              {refusal ?? "HQ doesn't let you connect a repository of this project."}
            </p>
          ) : step.kind === "no-app" ? (
            <p className="rv-note">
              Your organization has no GitHub app yet.{" "}
              <InlineButton onClick={onOpenAutomation}>
                Connect GitHub in Settings › Automation
              </InlineButton>
            </p>
          ) : step.kind === "unknown" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="rv-note">HQ didn't say whether your organization has a GitHub app.</p>
              <Button onClick={onCheckAgain} size="sm" variant="secondary">
                Check again
              </Button>
            </div>
          ) : step.kind === "waiting" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="rv-note">{waitingWords(step.account)}</p>
              {admin ? (
                <Button onClick={onOpenAutomation} size="sm" variant="secondary">
                  Open Settings › Automation
                </Button>
              ) : null}
            </div>
          ) : step.kind === "not-reached" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="rv-note">
                {step.name} doesn't reach {githubName(ask.url) ?? address} yet.{" "}
                {app !== null && app.kind === "connected" ? (
                  <GithubInstallOffer admin={admin} app={app} onInstall={onInstall}>
                    Add it on GitHub
                  </GithubInstallOffer>
                ) : (
                  <OutLink href={step.installUrl}>Add it on GitHub</OutLink>
                )}
              </p>
              <Button onClick={onCheckAgain} size="sm" variant="secondary">
                Check again
              </Button>
            </div>
          ) : (
            <p className="rv-note">
              {step.name} reaches {step.repository}.
            </p>
          )}
          {answer === null ? null : (
            <p className="rv-note" role="status">
              {answer}
            </p>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        {step.kind === "mounted" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} variant="ghost">
              Cancel
            </Button>
            {step.kind === "ready" ? (
              <Button disabled={busy || sent} onClick={() => void mount(step.repository)}>
                {busy || sent ? "Connecting…" : `Connect ${step.repository}`}
              </Button>
            ) : null}
          </>
        )}
      </DialogFooter>
    </>
  );
}
