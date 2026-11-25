/**
 * Every page of a repository stands in this frame: where it is, its way to GitHub and how HQ
 * follows it, Clone and Download, which branch, tag or commit the pages read, and the pages' tabs.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { githubRepositoryUrl } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHome, GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { GitHubIcon } from "~/components/Icons";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { GitTokenGuide } from "../GitTokenGuide";
import { ZeropsGitCredentials } from "../ZeropsGitCredentials";
import { GitArchiveButton, useGitArchive } from "./GitArchiveButton";
import { GIT_VIEW_TABS, type GitView } from "./GitBrowseView";
import { GitRefPicker } from "./GitRefPicker";
import { GitWhen } from "./GitWhen";
import { GitStorageFigure } from "./GitStorageFigure";
import { RepositoryUpkeep } from "../github/RepositoryUpkeep";
import { GitHomeAgain } from "./GitAtCommit";
import type { PickerChange } from "./GitRefPicker.logic";
import { Text } from "~/components/ui/text";
import { GitBrowserLink } from "./GitBrowserLink";
import { InPhoneBar } from "../system/PhoneBar";

/** How HQ follows GitHub, in one line. */
const mirrorLine = (mirror: NonNullable<GitHomeAbout["mirror"]>) =>
  mirror.divergedSince !== null
    ? `GitHub's main and Mate's main differ since ${mirror.divergedSince.slice(0, 10)}`
    : mirror.syncedAt === null
      ? "Not synced with GitHub yet"
      : `Synced with GitHub ${formatRelativeTimeLabel(mirror.syncedAt)}`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Facts supplied by the held home read; storage keeps its own existing control. */
export function GitRepoFacts({
  about,
  storage,
  again,
}: {
  readonly about: GitHomeAbout | null;
  readonly storage: ReactNode;
  readonly again?: ReactNode;
}) {
  const where =
    about?.remote === null
      ? "Only in Mate"
      : about?.mirror
        ? mirrorLine(about.mirror)
        : "On GitHub";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {about === null ? null : (
        <>
          <Text variant="note">
            {about.remote !== null && about.mirror?.syncedAt ? (
              <GitWhen at={about.mirror.syncedAt}>{where}</GitWhen>
            ) : (
              where
            )}
          </Text>
          <Text variant="note">
            <GitWhen at={about.updatedAt}>
              Updated {formatRelativeTimeLabel(about.updatedAt)}
            </GitWhen>
          </Text>
          <Text variant="note">{count(about.branchCount, "branch", "branches")}</Text>
          <Text variant="note">{count(about.tagCount, "tag", "tags")}</Text>
        </>
      )}
      {storage}
      {again}
    </div>
  );
}

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
            <Text render={<h2 />} variant="heading">
              Clone with HTTPS
            </Text>
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
  appId,
  project,
  repo,
  actions,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repo: string;
  readonly actions?: ReactNode;
}) {
  return (
    <PageHeader
      actions={actions}
      line={`${project}’s ${repo === "group" ? "setup repository" : "repository"}`}
      tag={repo === "group" ? <Badge>Setup</Badge> : undefined}
      title={repo}
      trail={
        <InPhoneBar>
          <WorkspaceBreadcrumb ariaLabel="Repository">
            <WorkspaceBreadcrumbItem>
              <GitBrowserLink to={{}} tone="muted">
                Git
              </GitBrowserLink>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem className="min-w-0 shrink">
              <GitBrowserLink to={{ appId }} tone="muted">
                {project}
              </GitBrowserLink>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem className="min-w-0 shrink" current>
              <span className="min-w-0 truncate">{repo}</span>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </InPhoneBar>
      }
    />
  );
}

/** The tabs and their picker, using the held open-change count. */
export function GitRepoTabs({
  view,
  openChanges,
  picker,
  onTab,
}: {
  readonly view: GitView;
  readonly openChanges: number | undefined;
  readonly picker: ReactNode;
  readonly onTab: (view: GitView) => void;
}) {
  const active = GIT_VIEW_TABS.find((tab) => tab.views.includes(view)) ?? GIT_VIEW_TABS[0]!;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {picker}
      <ToggleGroup
        aria-label="Repository page"
        variant="segmented"
        value={[active.label]}
        onValueChange={(value) => {
          const tab = GIT_VIEW_TABS.find((candidate) => candidate.label === value[0]) ?? active;
          onTab(tab.views[0]!);
        }}
      >
        {GIT_VIEW_TABS.map((tab) => (
          <Toggle key={tab.label} value={tab.label}>
            {tab.label}
            {tab.label === "Changes" && openChanges !== undefined
              ? ` ${String(openChanges)}`
              : null}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function GitRepoFrame({
  appId,
  repo,
  project,
  rev,
  view,
  home,
  onHomeAgain,
  changes,
  openChanges,
  banner,
  onPick,
  onTab,
}: {
  readonly appId: string;
  readonly repo: string;
  readonly project: string;
  readonly rev: string | undefined;
  readonly view: GitView;
  readonly home: GitBrowseState<GitHome>;
  readonly onHomeAgain: () => void;
  readonly changes: ReadonlyArray<PickerChange>;
  readonly openChanges: number | undefined;
  readonly banner?: ReactNode;
  readonly onPick: (rev: string) => void;
  readonly onTab: (view: GitView) => void;
}) {
  const about = home.state === "known" ? home.answer.about : null;
  return (
    <RepositoryUpkeep key={`${appId}:${repo}`} appId={appId} project={project} repo={repo}>
      {({ menu, status, storage }) => (
        <div className="flex min-w-0 flex-col gap-3">
          <GitRepoHeading
            appId={appId}
            project={project}
            repo={repo}
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
                {menu}
              </div>
            }
          />
          <GitRepoFacts
            about={about}
            storage={<GitStorageFigure view={storage} storage={about?.storage} />}
            again={
              home.state === "known" ? <GitHomeAgain home={home} onHomeAgain={onHomeAgain} /> : null
            }
          />
          {status}
          {banner}
          <GitRepoTabs
            view={view}
            openChanges={openChanges}
            onTab={onTab}
            picker={
              <GitRefPicker
                appId={appId}
                repo={repo}
                label={readingLabel(home, rev)}
                kind={home.state === "known" ? home.answer.ref.kind : null}
                changes={changes}
                mounted={about?.remote != null}
                onPick={onPick}
              />
            }
          />
        </div>
      )}
    </RepositoryUpkeep>
  );
}
