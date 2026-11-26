/**
 * Every page of a repository stands in this frame: where it is, its way to GitHub and how HQ
 * follows it, Clone and Download, which branch, tag or commit the pages read, and the pages' tabs.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { githubRepositoryUrl } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { GitHome, GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import {
  Code2Icon,
  FolderGit2Icon,
  GitCompareArrowsIcon,
  GitPullRequestIcon,
  HistoryIcon,
  SearchIcon,
} from "lucide-react";
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
import { Card } from "~/components/ui/card";
import { Fact, Facts } from "~/components/ui/facts";
import { LogoTile } from "~/components/ui/logo-tile";
import { SectionHeader } from "~/components/ui/section";
import { Tab, TabLabel, TabPress, TabStrip, useTabFolded } from "~/components/ui/tab-strip";
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

/** Facts supplied by the held home read; storage keeps its own existing control. */
export function GitRepoFacts({
  about,
  storage,
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
    <Card size="md" variant="sheet">
      <div className="flex min-w-0 flex-col gap-4">
        <SectionHeader level={3} size="panel" title="About" />
        {about === null ? null : (
          <>
            <Text variant="note">
              {about.remote !== null && about.mirror?.syncedAt ? (
                <GitWhen at={about.mirror.syncedAt}>{where}</GitWhen>
              ) : (
                where
              )}
            </Text>
            <Facts>
              <Fact label="Updated">
                <GitWhen at={about.updatedAt}>{formatRelativeTimeLabel(about.updatedAt)}</GitWhen>
              </Fact>
              <Fact label="Branches">{about.branchCount}</Fact>
              <Fact label="Tags">{about.tagCount}</Fact>
            </Facts>
          </>
        )}
        {storage}
      </div>
    </Card>
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
  where,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repo: string;
  readonly actions?: ReactNode;
  readonly where?: string | undefined;
}) {
  return (
    <PageHeader
      actions={actions}
      lead={
        <LogoTile size="lg">
          <FolderGit2Icon />
        </LogoTile>
      }
      line={`${project}’s ${repo === "group" ? "setup repository" : "repository"}`}
      tag={
        repo === "group" || where !== undefined ? (
          <span className="flex flex-wrap items-center gap-2">
            {repo === "group" ? <Badge>Setup</Badge> : null}
            {where === undefined ? null : <Badge>{where}</Badge>}
          </span>
        ) : undefined
      }
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

const TAB_ICONS: Readonly<Record<string, typeof Code2Icon>> = {
  Code: Code2Icon,
  Changes: GitPullRequestIcon,
  History: HistoryIcon,
  Compare: GitCompareArrowsIcon,
  Search: SearchIcon,
};

/** Folded tabs keep a visible mark while their labels remain available to assistive technology. */
function GitRepoTabIcon({ label }: { readonly label: string }) {
  const folded = useTabFolded();
  const Icon = TAB_ICONS[label];
  return folded && Icon !== undefined ? <Icon aria-hidden="true" size={16} /> : null;
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
      <div className="min-w-0 flex-1">
        <TabStrip
          activeId={active.label}
          items={GIT_VIEW_TABS.map((tab) => ({ id: tab.label, label: tab.label }))}
          onSelect={(id) => {
            const tab = GIT_VIEW_TABS.find((candidate) => candidate.label === id) ?? active;
            onTab(tab.views[0]!);
          }}
        >
          {GIT_VIEW_TABS.map((tab) => (
            <Tab active={tab === active} key={tab.label} size="md" tabId={tab.label}>
              <TabPress
                aria-pressed={tab === active}
                title={tab.label}
                onClick={() => onTab(tab.views[0]!)}
              >
                <GitRepoTabIcon label={tab.label} />
                <TabLabel>{tab.label}</TabLabel>
                {tab.label === "Changes" && openChanges !== undefined && openChanges > 0 ? (
                  <Badge tone="info">{openChanges}</Badge>
                ) : null}
              </TabPress>
            </Tab>
          ))}
        </TabStrip>
      </div>
    </div>
  );
}

/** The Code page and its About share the same responsive layout in the flow and the page. */
export function GitRepoColumns({
  children,
  about,
}: {
  readonly children: ReactNode;
  readonly about: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">{children}</div>
      <div className="min-w-0 self-start">{about}</div>
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
  where,
  children,
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
  readonly where?: string | undefined;
  readonly children: ReactNode;
  readonly onPick: (rev: string) => void;
  readonly onTab: (view: GitView) => void;
}) {
  const about = home.state === "known" ? home.answer.about : null;
  return (
    <RepositoryUpkeep key={`${appId}:${repo}`} appId={appId} project={project} repo={repo}>
      {({ menu, status, storage }) => (
        <div className="flex min-w-0 flex-col gap-12">
          <GitRepoHeading
            appId={appId}
            project={project}
            repo={repo}
            where={where}
            actions={
              <div className="flex max-w-36 flex-wrap items-center justify-end gap-2 sm:max-w-none">
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
          <div className="flex min-w-0 flex-col gap-5">
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
            {home.state === "known" ? <GitHomeAgain home={home} onHomeAgain={onHomeAgain} /> : null}
            {view === "home" ? (
              <GitRepoColumns
                about={
                  <GitRepoFacts
                    about={about}
                    storage={<GitStorageFigure view={storage} storage={about?.storage} />}
                  />
                }
              >
                {children}
              </GitRepoColumns>
            ) : (
              children
            )}
          </div>
        </div>
      )}
    </RepositoryUpkeep>
  );
}
