/**
 * Keeping an asked origin's code on GitHub: the asked repository's HQ repository mounts it through
 * the organization's GitHub app the connect picker names for it — what is missing first (an app,
 * its reach of the repository, the person's right), then, once HQ mounts it, whether GitHub lets
 * only what Mate approved reach main. No token is offered here.
 */
import type { RepoGovernanceRead } from "@t3tools/client-runtime/data";
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
import type { GitMirrorApps } from "~/zerops/useGitMirrorApps";

import { githubName, mirrorGateLine, waitingWords } from "../gitMirror.logic";
import { type GithubTrip, installWay, unsealedWords } from "../github/githubConnect.logic";
import { type OriginAsk, originAddress, originMountStep } from "./originAsk.logic";

/** What the container reads and does for the GitHub way. */
export interface OriginGithubProps {
  /** The organization's GitHub apps; `null` while read. */
  readonly apps: GitMirrorApps | null;
  /** The person looking, by Zerops user id. */
  readonly viewerId: string | null;
  /** The organization's name, which an app made for it is named after. */
  readonly organization: string | undefined;
  /** The Mate's application's repositories; `undefined` while HQ has not said. */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly rules: RepoGovernanceRead | undefined;
  /** HQ lets the person connect a repository of the application. */
  readonly mountable: boolean;
  /** HQ's words for why not, where it does not. */
  readonly refusal: string | undefined;
  /**
   * Mounts the asked repository as the app names it (`owner/name`) through the app `githubAppId`;
   * `null` once HQ took it.
   */
  readonly onMount: (repository: string, githubAppId: number) => Promise<string | null>;
  /** Reads the app again, after the person changed it on GitHub. */
  readonly onCheckAgain: () => void;
  /** Opens Settings › Automation, where GitHub is connected. */
  readonly onOpenAutomation: () => void;
  /** The person is the organization's Owner or an Admin: they may make the organization's app. */
  readonly admin: boolean;
  /** Leaves for GitHub's install page of the app `appId` through HQ's trip, coming back here. */
  readonly onInstall: (appId: number) => void;
  /** Leaves for GitHub to make the organization's app, named `name`, coming back here. */
  readonly onMake: (name: string) => void;
}

export function OriginGithubSheet({
  ask,
  mateName,
  apps,
  viewerId,
  organization,
  repos,
  rules,
  mountable,
  refusal,
  onMount,
  onCheckAgain,
  onOpenAutomation,
  admin,
  onInstall,
  onMake,
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
  const step = originMountStep({ ask, apps, repos, mountable, viewerId, admin, organization });
  const address = originAddress(ask.url);
  const name = githubName(ask.url) ?? address;
  const mount = async (repository: string, githubAppId: number) => {
    setBusy(true);
    setAnswer(null);
    const refused = await onMount(repository, githubAppId);
    setBusy(false);
    setSent(refused === null);
    setAnswer(refused);
  };
  // The app the mounted remote goes through, where the organization's apps name it.
  const through =
    step.kind === "mounted" && apps?.kind === "ready"
      ? (apps.apps.find((each) => each.appId === step.remote.githubAppId) ?? null)
      : null;
  const gate =
    step.kind === "mounted"
      ? mirrorGateLine(
          step.remote,
          rules?.kind === "read" ? rules.governance : undefined,
          through === null ? null : { name: through.name, appId: through.appId },
        )
      : undefined;
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
            <p className="mt-1.5 text-body text-muted-foreground">
              Reading your organization's GitHub app…
            </p>
          ) : step.kind === "mounted" ? (
            <>
              <p className="text-body leading-5.5 text-pretty">
                {ask.repo} keeps its code on {address}
                {through === null ? "" : ` through ${through.name}`}.
              </p>
              {gate === undefined ? null : (
                <p className="mt-1.5 text-body text-muted-foreground">{gate}</p>
              )}
            </>
          ) : step.kind === "taken" ? (
            <p className="mt-1.5 text-body text-muted-foreground">
              {ask.repo} already keeps its code with {gitRemoteLabel(step.url)}. Change it in the
              project's Mirror code to GitHub or GitLab.
            </p>
          ) : step.kind === "refused" ? (
            <p className="mt-1.5 text-body text-muted-foreground">
              {refusal ?? "HQ doesn't let you connect a repository of this project."}
            </p>
          ) : step.kind === "no-app" ? (
            <p className="mt-1.5 text-body text-muted-foreground">
              Your organization has no GitHub app yet.{" "}
              <InlineButton onClick={onOpenAutomation}>
                Connect GitHub in Settings › Automation
              </InlineButton>
            </p>
          ) : step.kind === "unknown" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mt-1.5 text-body text-muted-foreground">
                HQ didn't say whether your organization has a GitHub app.
              </p>
              <Button onClick={onCheckAgain} size="sm" variant="secondary">
                Try again
              </Button>
            </div>
          ) : step.kind === "waiting" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mt-1.5 text-body text-muted-foreground">{waitingWords(step.account)}</p>
              {admin ? (
                <Button onClick={onOpenAutomation} size="sm" variant="secondary">
                  Open Settings › Automation
                </Button>
              ) : null}
            </div>
          ) : step.kind === "unsealed" ? (
            <p className="mt-1.5 text-body text-muted-foreground">{unsealedWords(step.app)}</p>
          ) : step.kind === "not-reached" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mt-1.5 text-body text-muted-foreground">
                {step.unanswered > 0
                  ? "GitHub didn't answer about some installations, so the repositories they reach aren't listed."
                  : step.trip.kind === "install"
                    ? `${step.trip.app.name} doesn't reach ${name} yet.`
                    : `None of your organization's GitHub apps reaches ${name} yet.`}{" "}
                <NotReachedPress trip={step.trip} onInstall={onInstall} onMake={onMake} />
              </p>
              <Button onClick={onCheckAgain} size="sm" variant="secondary">
                Check again
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-body text-muted-foreground">
              {step.name} reaches {step.repository}.
            </p>
          )}
          {answer === null ? null : (
            <p className="mt-1.5 text-body text-muted-foreground" role="status">
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
              <Button
                disabled={busy || sent}
                onClick={() => void mount(step.repository, step.appId)}
              >
                {busy || sent ? "Connecting…" : `Connect ${step.repository}`}
              </Button>
            ) : null}
          </>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * How the person adds the repository, as the connect picker decides it (`githubTrip`): installs an
 * app they may be sent to — through HQ's trip, or on GitHub's own page where what they add waits
 * for an Owner or Admin's OK —, makes the organization's app, or asks an Owner or Admin.
 */
function NotReachedPress({
  trip,
  onInstall,
  onMake,
}: {
  readonly trip: GithubTrip;
  readonly onInstall: (appId: number) => void;
  readonly onMake: (name: string) => void;
}) {
  switch (trip.kind) {
    case "install": {
      const way = installWay(trip.app);
      return way.kind === "trip" ? (
        <InlineButton onClick={() => onInstall(trip.app.appId)}>Add it on GitHub</InlineButton>
      ) : (
        <>
          <OutLink href={way.url}>Add it on GitHub</OutLink> What you add waits for an Owner or
          Admin's OK.
        </>
      );
    }
    case "make":
      return (
        <>
          <InlineButton onClick={() => onMake(trip.name)}>
            Make your organization's app on GitHub
          </InlineButton>{" "}
          It is made on your own GitHub account, named {trip.name}.
        </>
      );
    case "ask":
      return "An Owner or Admin of your organization adds Mate on GitHub.";
  }
}
