import { useNowMs } from "~/zerops/useNowMs";
/** The organization Git overview renders the shared project and repository decisions. */
import {
  gitOverviewView as overviewView,
  gitOverviewGroups,
  gitStandingNotice,
  codeStandingLine,
  codeStandingSentence,
} from "@t3tools/client-runtime/zerops";
import { formatStorageBytes } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import { hqKeptGitQuestions, type KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { FolderGit2Icon, SearchIcon } from "lucide-react";
import { isChief } from "@t3tools/client-runtime/zerops/chief";
import { shownHqMateIdentitiesAtom, type HqMateIdentity } from "@t3tools/client-runtime/data";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty";
import { Failure } from "../ui/failure";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { LogoTile } from "../ui/logo-tile";
import { Section } from "../ui/section";
import { Skeleton } from "../ui/skeleton";
import { Tab, TabLabel, TabPress, TabStrip } from "../ui/tab-strip";
import ProjectCard, {
  GitRepositoryRows,
  GitSetup,
  GitStandingBadge,
  gitGroupFacts,
  type GitGroup,
  type GitLinks,
} from "./GitProjectCard";
import { useContext, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Loading } from "../ui/loading";
import { PageHeader } from "../ui/page-header";
import { Text } from "../ui/text";
import { InventoryContext, useAccountTrouble } from "~/zerops/inventoryContext";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useAccountDataOptional } from "~/zerops/ZeropsAccountData";
import { appBasePath } from "~/basePath";
import { useAddMate } from "~/zerops/newMate";
import { useCodeStandings, type CodeStandingView } from "~/zerops/useCodeStandings";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";
import { useMateNames, useProjectFlows } from "~/zerops/projectFlows";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { gitPageState, type GitPageState } from "./ZeropsGitPage.logic";
import { useAccountOrgId, useProjection } from "~/zerops/accountData";
import { KeptCodeQuestion, useKeptCodeAnswer } from "./KeptCodeQuestion";
import { CodeStandingActions, CodeStandingBanner } from "./CodeStandingActions";
import { GitBrowserLink, useGitLinkProps } from "./gitBrowser/GitBrowserLink";
import { InPhoneBar } from "./system/PhoneBar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

const NO_QUESTIONS = Atom.make<ReadonlyArray<KeptGitQuestionView>>([]);

function Reading({ count = 3 }: { readonly count?: number }) {
  return (
    <Loading label="Projects and their repositories" data-zerops-surface="git-reading">
      <div className="flex flex-col gap-4">
        {Array.from({ length: count }, (_, index) => (
          <Card key={index} variant="sheet">
            <div className="flex flex-col gap-4 px-5 py-4">
              <Skeleton className="h-5 w-56" shape="pill" surface="card" />
              {Array.from({ length: count - index }, (_, row) => (
                <div className="flex items-center gap-3" key={row}>
                  <Skeleton className="size-5.5" surface="card" />
                  <Skeleton className="h-4 w-32" shape="pill" surface="card" />
                  <Skeleton className="ms-24 h-4 w-40" shape="pill" surface="card" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Loading>
  );
}

type OverviewProps = {
  readonly state: GitPageState;
  readonly standingOf: (appId: string) => CodeStandingView;
  readonly questions?: ReadonlyArray<KeptGitQuestionView>;
  readonly answer?:
    | ((view: KeptGitQuestionView, answer: "keep" | "delete") => Promise<void>)
    | undefined;
  readonly visible?: boolean;
  readonly onAgain?: (() => void) | undefined;
  readonly onAddMate?: ((appId: string) => void) | undefined;
  readonly onDelete?: ((appId: string) => void) | undefined;
  readonly onReview?: ((appId: string) => void) | undefined;
  readonly onOpenProject?: ((appId: string) => void) | undefined;
  readonly chiefByApp?:
    | ReadonlyMap<string, { readonly identity?: HqMateIdentity | undefined }>
    | undefined;
  readonly repositoryHref?: ((appId: string, repo: string, view?: "changes") => string) | undefined;
  readonly onOpenRepository?: ((appId: string, repo: string, view?: "changes") => void) | undefined;
};

export function ZeropsGitOverview(props: OverviewProps) {
  const { state, visible = true, standingOf, questions = [] } = props;
  const [tab, setTab] = useState<"all" | "open" | "kept">("all");
  const [query, setQuery] = useState("");
  if (!visible) return null;
  const apps = state.kind === "read" ? state.apps : [];
  const openQuestions = questions.map(({ question }) => question);
  const overview = gitOverviewGroups(apps, (id) => standingOf(id).standing, openQuestions);
  const shown = overviewView(overview, tab, query, state.kind === "read" ? state.refusals : []);
  const card = (group: GitGroup) => {
    const question = questions.find(({ question }) => question.appId === group.appId);
    return (
      <ProjectCard
        key={group.appId}
        group={group}
        view={standingOf(group.appId)}
        question={question}
        answer={
          question === undefined || props.answer === undefined
            ? undefined
            : (choice) => props.answer!(question, choice)
        }
        chief={props.chiefByApp?.get(group.appId)}
        repositoryHref={props.repositoryHref}
        onOpenRepository={props.onOpenRepository}
        onOpenProject={
          props.onOpenProject === undefined ? undefined : () => props.onOpenProject!(group.appId)
        }
        onAddMate={() => props.onAddMate?.(group.appId)}
        onDelete={() => props.onDelete?.(group.appId)}
        onReview={() => props.onReview?.(group.appId)}
      />
    );
  };
  const failure = state.kind === "refused" ? null : state.failure;
  const reading =
    (state.kind === "unread" && failure === null) ||
    (state.kind === "read" && state.reading === true);
  const empty =
    state.kind === "read" &&
    overview.projects === 0 &&
    shown.refusalCount === 0 &&
    !reading &&
    failure === null;
  const nothing =
    shown.waiting.length + shown.projects.length + shown.kept.length + shown.refusals.length === 0;
  const tabs = [
    { id: "all" as const, label: "All projects" },
    { id: "open" as const, label: "Open changes", count: overview.openChanges },
    { id: "kept" as const, label: "Kept code", count: overview.keptCount },
  ];
  return (
    <div className="flex flex-col gap-8" data-zerops-surface="git-overview">
      <InPhoneBar>
        <PageHeader
          title="Git"
          line="Your organisation's code, by project."
          actions={
            state.kind === "unread" || state.kind === "refused" || empty ? undefined : (
              <InputGroup className="w-72">
                <InputGroupAddon>
                  <SearchIcon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  size="sm"
                  aria-label="Find a project or repository"
                  placeholder="Find a project or repository"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
            )
          }
        />
      </InPhoneBar>
      {state.kind === "refused" ? (
        <Failure
          size="page"
          cause={state.reason}
          mark={
            <LogoTile size="xl">
              <FolderGit2Icon />
            </LogoTile>
          }
        />
      ) : empty ? (
        <EmptyState
          size="page"
          title="No code yet"
          mark={
            <LogoTile size="xl">
              <FolderGit2Icon />
            </LogoTile>
          }
          action={
            <Button size="sm" variant="secondary" render={<a href={`${appBasePath()}/zerops`} />}>
              Open Projects
            </Button>
          }
        >
          A project's repositories appear here once its first Mate is set up.
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <TabStrip
              activeId={tab}
              items={tabs}
              onSelect={(id) => {
                if (id === "all" || id === "open" || id === "kept") setTab(id);
              }}
            >
              {tabs.map((item) => (
                <Tab key={item.id} tabId={item.id} active={tab === item.id} size="md">
                  <TabPress onClick={() => setTab(item.id)} aria-pressed={tab === item.id}>
                    <TabLabel>{item.label}</TabLabel>
                    {item.count === undefined || item.count === 0 ? null : (
                      <Badge count tone={item.id === "open" ? "info" : "neutral"}>
                        {item.count}
                      </Badge>
                    )}
                  </TabPress>
                </Tab>
              ))}
            </TabStrip>
            {state.kind === "read" ? (
              <Text variant="meta">
                {overview.repositories}{" "}
                {overview.repositories === 1 ? "repository" : "repositories"}
                {overview.size.complete ? ` · ${formatStorageBytes(overview.size.bytes)}` : ""}
              </Text>
            ) : null}
          </div>
          {failure === null ? null : (
            <Failure
              cause={failure}
              action={
                <Button size="sm" variant="secondary" onClick={props.onAgain}>
                  Read again
                </Button>
              }
            >
              {state.kind === "read" &&
              state.apps.some((app) => app.repositories.some((repo) => repo.coverage !== "unread"))
                ? "Showing the last read list."
                : undefined}
            </Failure>
          )}
          {shown.waiting.length === 0 ? null : (
            <Section title="Waiting on you" count={shown.waiting.length}>
              <div className="flex flex-col gap-4">{shown.waiting.map(card)}</div>
            </Section>
          )}
          {shown.projects.length + shown.refusals.length === 0 ? null : (
            <Section
              title={tab === "open" ? "With open changes" : "Projects"}
              count={shown.projects.length + shown.refusals.length}
            >
              <div className="flex flex-col gap-4">
                {shown.projects.map(card)}
                {shown.refusals.map(({ appId, name, reason }) => (
                  <Card key={appId} variant="sheet">
                    <div className="flex flex-col gap-1 px-5 py-4">
                      <Text variant="headline">{name}</Text>
                      <Failure size="line" cause={reason} />
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          )}
          {shown.kept.length === 0 ? null : (
            <Section
              title="Kept code"
              count={shown.kept.length}
              line="Nobody works on these projects. Add a Mate to start again, or delete what you no longer need."
              action={
                overview.keptSize.complete ? (
                  <Text variant="meta">
                    {formatStorageBytes(overview.keptSize.bytes)} billed as storage
                  </Text>
                ) : undefined
              }
            >
              <div className="flex flex-col gap-4">{shown.kept.map(card)}</div>
            </Section>
          )}
          {nothing && !reading && failure === null ? (
            <EmptyState size="line">
              {query.trim() !== ""
                ? `No project or repository matches “${query.trim()}”.`
                : tab === "open"
                  ? "No open changes."
                  : tab === "kept"
                    ? "No kept code."
                    : null}
            </EmptyState>
          ) : null}
          {reading ? <Reading count={overview.projects === 0 ? 3 : 1} /> : null}
        </>
      )}
    </div>
  );
}

const STANDING_CARD = {
  off: { variant: "wash" as const },
  attention: { variant: "wash" as const, tone: "attention" as const },
  busy: { variant: "wash" as const, tone: "busy" as const },
  failed: { variant: "flat" as const, tone: "failed" as const },
  ok: { variant: "wash" as const },
};

/** A project's code and its standing, using the same rows and offers as the overview. */
export function ProjectCode({
  appId,
  name,
  group,
  state,
  view,
  question,
  answer,
  onAgain,
  onOpenProject,
  onAddMate,
  onDelete,
  onReview,
  repositoryHref,
  onOpenRepository,
}: GitLinks & {
  readonly appId: string;
  readonly name: string;
  readonly group?: GitGroup | undefined;
  readonly state: GitPageState;
  readonly view: CodeStandingView;
  readonly question?: KeptGitQuestionView | undefined;
  readonly answer?: ((choice: "keep" | "delete") => Promise<void>) | undefined;
  readonly onAgain?: (() => void) | undefined;
  readonly onOpenProject?: (() => void) | undefined;
  readonly onAddMate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onReview?: (() => void) | undefined;
}) {
  const standing = group?.standing ?? view.standing;
  const line =
    codeStandingSentence(name, standing) ??
    (standing.kind === "unread" ? codeStandingLine(standing)?.words : undefined);
  const notice = gitStandingNotice(standing);
  const banner = (presses?: React.ReactNode, lines?: React.ReactNode) => (
    <Card size="md" {...STANDING_CARD[notice?.tone ?? "off"]}>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 max-w-2xl flex-col gap-1">
          {line === undefined ? null : <Text variant="description">{line}</Text>}
          {lines}
          {view.stopped === undefined ? null : <Failure size="line" cause={view.stopped} />}
        </div>
        {question === undefined ? (
          <CodeStandingActions
            name={name}
            view={view}
            emphasis
            onAddMate={onAddMate}
            onDelete={onDelete}
            onReview={onReview}
          />
        ) : (
          presses
        )}
      </div>
    </Card>
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={name}
        tag={<GitStandingBadge standing={standing} />}
        line={group?.listed ? gitGroupFacts(group) : undefined}
        trail={
          <InPhoneBar>
            <WorkspaceBreadcrumb ariaLabel="Project code">
              <WorkspaceBreadcrumbItem>
                <GitBrowserLink to={{}} tone="muted">
                  Git
                </GitBrowserLink>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current>{name}</WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          </InPhoneBar>
        }
        actions={
          <>
            {group === undefined ? null : (
              <GitSetup
                group={group}
                repositoryHref={repositoryHref}
                onOpenRepository={onOpenRepository}
              />
            )}
            {standing.kind !== "in-use" ? null : (
              <Button
                variant="secondary"
                size="sm"
                render={<a href={`${appBasePath()}/group/${encodeURIComponent(appId)}/flow`} />}
                onClick={(event) => {
                  if (
                    onOpenProject === undefined ||
                    event.button !== 0 ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey ||
                    event.shiftKey
                  )
                    return;
                  event.preventDefault();
                  onOpenProject();
                }}
              >
                Open {name}
              </Button>
            )}
          </>
        }
      />
      {state.kind === "refused" ? (
        <Failure size="page" cause={state.reason} />
      ) : (
        <>
          {state.failure === null ? null : (
            <Failure
              cause={state.failure}
              action={
                <Button size="sm" variant="secondary" onClick={onAgain}>
                  Read again
                </Button>
              }
            />
          )}
          {standing.kind === "in-use" ? null : question === undefined ? (
            banner()
          ) : (
            <KeptCodeQuestion view={question} answer={answer}>
              {({ presses, lines }) => banner(presses, lines)}
            </KeptCodeQuestion>
          )}
          {group === undefined ? (
            state.failure === null ? (
              <Loading shape="rows" count={3} label="Repositories" />
            ) : null
          ) : (
            <Section title="Repositories" count={group.repositoryCount}>
              {group.repositories.length === 0 ? (
                <EmptyState size="line">
                  {name} has no code repository. Its setup files are under Setup.
                </EmptyState>
              ) : (
                <Card variant="sheet">
                  <GitRepositoryRows
                    appId={appId}
                    repositories={group.repositories}
                    repositoryHref={repositoryHref}
                    onOpenRepository={onOpenRepository}
                  />
                </Card>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export function ProjectCodeGone() {
  const git = useGitLinkProps({});
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Project"
        placeholder
        trail={
          <InPhoneBar>
            <WorkspaceBreadcrumb ariaLabel="Project code">
              <WorkspaceBreadcrumbItem>
                <GitBrowserLink to={{}} tone="muted">
                  Git
                </GitBrowserLink>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current>Project</WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          </InPhoneBar>
        }
      />
      <EmptyState
        size="page"
        title="This project is not here"
        mark={
          <LogoTile size="xl">
            <FolderGit2Icon />
          </LogoTile>
        }
        action={
          <Button variant="secondary" render={<a {...git} />}>
            Back to Git
          </Button>
        }
      >
        It was deleted or your access was removed.
      </EmptyState>
    </div>
  );
}

export function ZeropsGitPage() {
  const nowMs = useNowMs();
  const { activeOrganization } = useZeropsSession();
  const retryAccount = useAccountDataOptional()?.retry;
  const flow = useProjectFlows("every");
  const mateNames = useMateNames();
  const registry = useZeropsRegistry();
  const offersOf = useChangeOffers();
  const standingOf = useCodeStandings();
  const orgId = useAccountOrgId();
  const questions = useProjection(hqKeptGitQuestions, orgId, NO_QUESTIONS);
  const answer = useKeptCodeAnswer();
  const addMate = useAddMate();
  const inventory = useContext(InventoryContext);
  const identities = useAtomValue(shownHqMateIdentitiesAtom);
  const chiefByApp = useMemo(() => {
    const chiefs = new Map<string, { identity?: HqMateIdentity | undefined }>();
    for (const project of inventory?.projects ?? []) {
      if (
        project.hq?.appId != null &&
        (project.hq.kind === "mate" || project.hq.kind === "devstage") &&
        isChief(project)
      )
        chiefs.set(project.hq.appId, { identity: identities[project.id] });
    }
    return chiefs;
  }, [inventory?.projects, identities]);
  const accountTrouble = useAccountTrouble();
  const navigate = useNavigate();
  const search = useSearch({ from: "/git" });
  // Each application's repositories and changes are its detail: held while the page draws it.
  useHqAppDetailHold(registry.registry.groups.map(({ groupId }) => groupId));
  // Every application the person may read the changes of: the one whose changes HQ's rule keeps
  // from them is listed elsewhere, and is not read here.
  const apps = useMemo(
    () =>
      registry.registry.groups.map((group) => {
        const groupFlow = flow.flows.get(group.groupId);
        const offers = offersOf(group.groupId);
        return {
          appId: group.groupId,
          name: group.name,
          read: offers?.read,
          readReason: offers?.why.read,
          changes: groupFlow?.changesKnown === true ? groupFlow.pullRequests : undefined,
          repositories: groupFlow?.repos,
          failure: flow.releaseFailures.get(group.groupId) ?? groupFlow?.changesFailure,
        };
      }),
    [flow.flows, flow.releaseFailures, offersOf, registry.registry.groups],
  );
  const state = gitPageState({
    now: nowMs,
    appsKnown: !registry.loading,
    apps,
    failure: flow.readFailure ?? inventory?.error ?? undefined,
    mateName: (projectId) => mateNames.get(projectId),
  });
  const overviewApp =
    state.kind === "read" ? state.apps.find((app) => app.appId === search.appId) : undefined;
  const repository = overviewApp?.repositories.find((repo) => repo.name === search.repo);
  const selectedApp = apps.find((app) => app.appId === search.appId);
  const detailOpen = search.appId !== undefined && search.repo !== undefined;
  const projectOpen = search.appId !== undefined && search.repo === undefined;
  const projectState = gitPageState({
    now: nowMs,
    appsKnown: !registry.loading,
    apps: selectedApp === undefined ? [] : [selectedApp],
    failure: flow.readFailure ?? inventory?.error ?? undefined,
    mateName: (projectId) => mateNames.get(projectId),
  });
  const selectedStanding = search.appId === undefined ? undefined : standingOf(search.appId);
  const projectGroup =
    search.appId === undefined
      ? undefined
      : gitOverviewGroups(
          projectState.kind === "read" ? projectState.apps : [],
          (id) => standingOf(id).standing,
          questions
            .map(({ question }) => question)
            .filter((question) => question.appId === search.appId),
        ).groups.find((group) => group.appId === search.appId);
  const projectQuestion = questions.find(({ question }) => question.appId === search.appId);
  const sentence =
    selectedStanding === undefined
      ? undefined
      : codeStandingSentence(selectedApp?.name ?? "Project", selectedStanding.standing);
  const readAgain = () => {
    retryAccount?.();
    if (inventory?.error || accountTrouble?.trouble) accountTrouble?.retry();
  };
  const openChange = (appId: string, repository: string, number: number) => {
    void navigate({
      to: "/change/$groupId/$repository/$number",
      params: { groupId: appId, repository, number: String(number) },
    });
  };
  const deleteGroup = (appId: string) => {
    void navigate({
      to: "/projects/$projectKey/delete",
      params: { projectKey: appId },
      search: {},
    });
  };

  return (
    <ZeropsHostedFrame bar={false} width={detailOpen ? "full" : "wide"}>
      {projectOpen && search.appId !== undefined && selectedStanding !== undefined ? (
        !registry.loading && selectedApp === undefined && projectGroup === undefined ? (
          <ProjectCodeGone />
        ) : (
          <ProjectCode
            appId={search.appId}
            name={selectedApp?.name ?? projectGroup?.name ?? "Project"}
            group={projectGroup}
            state={projectState}
            view={selectedStanding}
            question={projectQuestion}
            answer={
              projectQuestion === undefined || answer === undefined
                ? undefined
                : (choice) => answer(projectQuestion, choice)
            }
            onAgain={readAgain}
            repositoryHref={(appId, repo, view) =>
              `${appBasePath()}/git?${new URLSearchParams({ appId, repo, ...(view === undefined ? {} : { view }) })}`
            }
            onOpenRepository={(appId, repo, view) => {
              void navigate({
                to: "/git",
                search: { appId, repo, ...(view === undefined ? {} : { view }) },
              });
            }}
            onOpenProject={() => {
              void navigate({ to: "/group/$groupId/flow", params: { groupId: search.appId! } });
            }}
            onAddMate={() => addMate(search.appId!)}
            onDelete={() => deleteGroup(search.appId!)}
            onReview={() => deleteGroup(search.appId!)}
          />
        )
      ) : null}
      {search.appId !== undefined && search.repo !== undefined ? (
        <ZeropsRepositoryBrowser
          key={`${activeOrganization?.id}:${search.appId}:${search.repo}`}
          allowed={offersOf(search.appId)?.read}
          accessReason={offersOf(search.appId)?.why.read}
          banner={
            selectedStanding === undefined ? undefined : (
              <CodeStandingBanner
                sentence={sentence}
                name={selectedApp?.name ?? "Project"}
                view={selectedStanding}
                onAddMate={() => addMate(search.appId!)}
                onDelete={() => deleteGroup(search.appId!)}
                onReview={() => deleteGroup(search.appId!)}
                answer={<GitBrowserLink to={{ appId: search.appId }}>Answer on Git</GitBrowserLink>}
              />
            )
          }
          appId={search.appId}
          appsKnown={!registry.loading}
          appListed={selectedApp !== undefined}
          repositories={
            selectedApp?.repositories === undefined
              ? undefined
              : overviewApp?.repositories.map(({ name }) => name)
          }
          project={selectedApp?.name ?? "Project"}
          repository={repository}
          changesFailure={selectedApp?.failure ?? flow.readFailure ?? inventory?.error ?? undefined}
          onReadChanges={readAgain}
          onOpenChange={(number) => openChange(search.appId!, search.repo!, number)}
          repo={search.repo}
          query={search}
          onBack={() => {
            void navigate({ to: "/git", search: {} });
          }}
          onNavigate={(query) => {
            void navigate({
              to: "/git",
              search: { appId: search.appId!, repo: search.repo!, ...query },
            });
          }}
        />
      ) : null}
      {detailOpen || projectOpen ? null : (
        <ZeropsGitOverview
          key={activeOrganization?.id ?? "unscoped"}
          onAgain={readAgain}
          standingOf={standingOf}
          chiefByApp={chiefByApp}
          onOpenProject={(appId) => {
            void navigate({ to: "/git", search: { appId } });
          }}
          questions={questions}
          answer={answer}
          onAddMate={addMate}
          onDelete={deleteGroup}
          onReview={deleteGroup}
          repositoryHref={(appId, repo, view) =>
            `${appBasePath()}/git?${new URLSearchParams({ appId, repo, ...(view === undefined ? {} : { view }) })}`
          }
          onOpenRepository={(appId, repo, view) => {
            void navigate({
              to: "/git",
              search: { appId, repo, ...(view === undefined ? {} : { view }) },
            });
          }}
          state={state}
        />
      )}
    </ZeropsHostedFrame>
  );
}
