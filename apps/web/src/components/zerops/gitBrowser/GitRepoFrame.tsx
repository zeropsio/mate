/**
 * Every page of a repository stands in this frame: where it is, its way to GitHub and how HQ
 * follows it, Clone and Download, which branch, tag or commit the pages read, and the pages' tabs.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { githubRepositoryUrl } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHome, GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { GitHubIcon } from "~/components/Icons";
import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { GitTokenGuide } from "../GitTokenGuide";
import { ZeropsGitCredentials } from "../ZeropsGitCredentials";
import { GitArchiveButton, useGitArchive } from "./GitArchiveButton";
import { GIT_VIEW_TABS, type GitView } from "./GitBrowseView";
import { GitRefPicker } from "./GitRefPicker";
import { GitWhen } from "./GitWhen";
import type { PickerChange } from "./GitRefPicker.logic";

/** How HQ follows GitHub, in one line. */
const mirrorLine = (mirror: NonNullable<GitHomeAbout["mirror"]>) =>
  mirror.divergedSince !== null
    ? `GitHub's main and Mate's main differ since ${mirror.divergedSince.slice(0, 10)}`
    : mirror.syncedAt === null
      ? "Not synced with GitHub yet"
      : `Synced with GitHub ${formatRelativeTimeLabel(mirror.syncedAt)}`;

/** What the picker's button says the pages read. */
const readingLabel = (home: GitBrowseState<GitHome>, rev: string | undefined) => {
  if (home.state !== "known") return rev ?? "main";
  return home.answer.ref.kind === "commit" && home.answer.sha !== null
    ? `Commit ${home.answer.sha.slice(0, 7)}`
    : home.answer.ref.name;
};

function ClonePopover({
  appId,
  repo,
  project,
  sha,
}: {
  readonly appId: string;
  readonly repo: string;
  readonly project: string;
  /** The commit the pages read; none before it is known or where there is none. */
  readonly sha: string | null;
}) {
  const archive = useGitArchive(appId, repo, sha);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary" size="sm" />}>Clone</PopoverTrigger>
      <PopoverPopup align="end" width="lg">
        <div className="flex flex-col gap-4">
          <section aria-label="Clone with HTTPS" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">Clone with HTTPS</h2>
            <ZeropsGitCredentials appId={appId} repo={repo} />
          </section>
          {repo === "group" ? null : <GitTokenGuide key={`${appId}:${repo}`} project={project} />}
          {sha === null ? null : <GitArchiveButton archive={archive} />}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function GitRepoHeading({
  project,
  repo,
  onBack,
  actions,
}: {
  readonly project: string;
  readonly repo: string;
  readonly onBack: () => void;
  readonly actions?: ReactNode;
}) {
  return (
    <>
      <nav className="flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label="Repository">
        <InlineButton onClick={onBack}>Git</InlineButton>
        <span className="text-muted-foreground"> / {project} / </span>
        <span className="break-all font-medium text-foreground">{repo}</span>
        {repo === "group" ? <Badge>Setup</Badge> : null}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-medium text-foreground">{repo}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project}’s {repo === "group" ? "setup repository" : "repository"}
          </p>
        </div>
        {actions}
      </div>
    </>
  );
}

export function GitRepoFrame({
  appId,
  repo,
  project,
  rev,
  view,
  home,
  changes,
  onBack,
  onPick,
  onTab,
}: {
  readonly appId: string;
  readonly repo: string;
  readonly project: string;
  readonly rev: string | undefined;
  readonly view: GitView;
  readonly home: GitBrowseState<GitHome>;
  readonly changes: ReadonlyArray<PickerChange>;
  readonly onBack: () => void;
  readonly onPick: (rev: string) => void;
  readonly onTab: (view: GitView) => void;
}) {
  const about = home.state === "known" ? home.answer.about : null;
  // A tab opens its first page; which one is lit follows the page shown.
  const active = GIT_VIEW_TABS.find((tab) => tab.views.includes(view)) ?? GIT_VIEW_TABS[0]!;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <GitRepoHeading
        project={project}
        repo={repo}
        onBack={onBack}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {about?.remote ? (
              <Button
                render={
                  <a
                    href={githubRepositoryUrl(about.remote)}
                    rel="noopener noreferrer"
                    target="_blank"
                  />
                }
                size="sm"
                variant="secondary"
              >
                <GitHubIcon aria-hidden="true" />
                Open on GitHub
              </Button>
            ) : null}
            <ClonePopover
              appId={appId}
              repo={repo}
              project={project}
              sha={home.state === "known" ? home.answer.sha : null}
            />
          </div>
        }
      />
      {about?.mirror ? (
        <p className="text-xs text-muted-foreground">
          {about.mirror.syncedAt === null ? (
            mirrorLine(about.mirror)
          ) : (
            <GitWhen at={about.mirror.syncedAt}>{mirrorLine(about.mirror)}</GitWhen>
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <GitRefPicker
          appId={appId}
          repo={repo}
          label={readingLabel(home, rev)}
          kind={home.state === "known" ? home.answer.ref.kind : null}
          changes={changes}
          mounted={about?.remote != null}
          onPick={onPick}
        />
        <ToggleGroup
          aria-label="Repository page"
          variant="segmented"
          value={[active.label]}
          onValueChange={(value) => {
            // The lit tab, pressed again, opens its first page.
            const tab = GIT_VIEW_TABS.find((candidate) => candidate.label === value[0]) ?? active;
            onTab(tab.views[0]!);
          }}
        >
          {GIT_VIEW_TABS.map((tab) => (
            <Toggle key={tab.label} value={tab.label}>
              {tab.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Browsing source does not switch a Mate’s checkout.
        </p>
      </div>
    </div>
  );
}
