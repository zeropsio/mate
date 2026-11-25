/** The organization Git overview renders the shared project and repository decisions. */
import {
  gitChangesSummary,
  gitOverviewGroups,
  codeStandingLine,
  codeStandingSentence,
} from "@t3tools/client-runtime/zerops";
import { formatStorageBytes } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import { hqKeptGitQuestions, type KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useContext, useMemo, useState } from "react";
import { Button, InlineButton } from "../ui/button";
import { Card } from "../ui/card";
import { List } from "../ui/list";
import { Loading } from "../ui/loading";
import { PageHeader } from "../ui/page-header";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { InventoryContext, useAccountTrouble } from "~/zerops/inventoryContext";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useAccountDataOptional } from "~/zerops/ZeropsAccountData";
import { appBasePath } from "~/basePath";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useAddMate } from "~/zerops/newMate";
import { useCodeStandings, type CodeStandingView } from "~/zerops/useCodeStandings";
import { useHqStructure } from "~/zerops/useHqOffers";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";
import { useMateNames, useProjectFlows } from "~/zerops/projectFlows";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { gitPageState, repositoryWhere, type GitPageState } from "./ZeropsGitPage.logic";
import { useDeleteApplicationDialog } from "./deleteApplicationDialog";
import { lastMateDeletionTarget } from "./ZeropsDeleteApplicationDialog.logic";
import { useAccountOrgId, useProjection } from "~/zerops/accountData";
import { KeptCodeQuestion, useKeptCodeAnswer } from "./KeptCodeQuestion";
import { CodeStandingActions, CodeStandingBanner } from "./CodeStandingActions";
import { GitBrowserLink } from "./gitBrowser/GitBrowserLink";
import { InPhoneBar } from "./system/PhoneBar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

const NO_QUESTIONS = Atom.make<ReadonlyArray<KeptGitQuestionView>>([]);

function Reading() {
  return (
    <Loading
      count={4}
      data-zerops-surface="git-reading"
      label="Repositories and changes"
      shape="page"
    />
  );
}

function ReadTrouble({
  failure,
  onAgain,
}: {
  readonly failure: string | null;
  readonly onAgain?: (() => void) | undefined;
}) {
  if (failure === null) return null;
  return (
    <div className="flex flex-col gap-2" data-zerops-surface="git-read-trouble">
      <p className="text-body text-status-failed" role="alert">
        {failure}
      </p>
      {onAgain === undefined ? null : (
        <div>
          <Button variant="ghost" size="sm" onClick={onAgain}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}

type GitGroup = ReturnType<typeof gitOverviewGroups>["used"][number];
type OverviewProps = {
  readonly state: GitPageState;
  readonly standingOf: (appId: string) => CodeStandingView;
  readonly questions?: ReadonlyArray<KeptGitQuestionView>;
  readonly answer?:
    | ((view: KeptGitQuestionView, answer: "keep" | "delete") => Promise<void>)
    | undefined;
  readonly visible?: boolean;
  readonly only?: string | undefined;
  readonly onAgain?: (() => void) | undefined;
  readonly onAddMate?: ((appId: string) => void) | undefined;
  readonly onDelete?: ((appId: string) => void) | undefined;
  readonly onReview?: ((appId: string) => void) | undefined;
  readonly repositoryHref?: ((appId: string, repo: string, view?: "changes") => string) | undefined;
  readonly onOpenRepository?: ((appId: string, repo: string, view?: "changes") => void) | undefined;
};

function ProjectGroup({
  group,
  standingOf,
  questions,
  answer,
  onAddMate,
  onDelete,
  onReview,
  repositoryHref,
  onOpenRepository,
  only,
}: Omit<OverviewProps, "state"> & { readonly group: GitGroup }) {
  const standingView = standingOf(group.appId);
  const { standing } = group;
  const question = questions?.find(({ question }) => question.appId === group.appId);
  const line = codeStandingLine(standing);
  const setupOpen = group.setup?.changes.filter(({ pull }) => pull.state === "open").length ?? 0;
  const link = (repo: string, label: React.ReactNode, view?: "changes") =>
    repositoryHref === undefined ? (
      label
    ) : (
      <InlineButton
        tone="plain"
        render={<a href={repositoryHref(group.appId, repo, view)} />}
        onClick={(event) => {
          if (
            onOpenRepository === undefined ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          event.preventDefault();
          onOpenRepository(group.appId, repo, view);
        }}
      >
        {label}
      </InlineButton>
    );
  return (
    <Card variant="flat">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {only === undefined ? (
              <Text render={<h3 />} variant="label">
                {group.name}
              </Text>
            ) : null}
            {group.setup === undefined ? null : (
              <Text variant="note">
                {link("group", <>Setup{setupOpen > 0 ? ` · ${String(setupOpen)} open` : ""}</>)}
              </Text>
            )}
            {only === undefined && group.listed ? (
              <Text variant="note">
                {group.repositoryCount}{" "}
                {group.repositoryCount === 1 ? "repository" : "repositories"}
                {group.size.complete ? ` · ${formatStorageBytes(group.size.bytes)}` : ""}
              </Text>
            ) : null}
          </div>
          {only === undefined &&
          question === undefined &&
          line !== undefined &&
          (line.notice || standing.kind === "unread") ? (
            <Text variant="description">{line.words}</Text>
          ) : null}
          {question === undefined ? null : (
            <KeptCodeQuestion
              key={`${question.question.appId}:${question.question.askedAt}`}
              view={question}
              answer={answer === undefined ? undefined : (choice) => answer(question, choice)}
            />
          )}
        </div>
        {only === undefined && question === undefined ? (
          <CodeStandingActions
            name={group.name}
            view={standingView}
            onAddMate={() => onAddMate?.(group.appId)}
            onDelete={() => onDelete?.(group.appId)}
            onReview={() => onReview?.(group.appId)}
          />
        ) : null}
      </div>
      {group.repositories.length > 0 ? (
        <>
          <Separator />
          <List>
            {group.repositories.map((repository) => {
              const where = repositoryWhere(repository.facts);
              const summary = gitChangesSummary(repository.changes);
              const facts = [
                where,
                repository.facts === undefined
                  ? undefined
                  : `updated ${formatRelativeTimeLabel(repository.facts.updatedAt)}`,
                repository.facts?.usedBytes === undefined
                  ? undefined
                  : formatStorageBytes(repository.facts.usedBytes),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  className="flex flex-col gap-1 px-4 py-3"
                  key={repository.name}
                  data-zerops-git-app={group.appId}
                  data-zerops-git-repository={repository.name}
                >
                  <Text variant="label">{link(repository.name, repository.name)}</Text>
                  <Text variant="note">
                    {facts}
                    {summary === undefined ? null : (
                      <>
                        {facts === "" ? null : " · "}
                        {link(repository.name, summary, "changes")}
                      </>
                    )}
                    {repository.coverage === "unread"
                      ? `${facts === "" && summary === undefined ? "" : " · "}Changes not read yet.`
                      : null}
                  </Text>
                </div>
              );
            })}
          </List>
        </>
      ) : group.listed && group.repositoryCount === 0 ? (
        <>
          <Separator />
          <div className="px-4 py-3">
            <Text variant="note">
              {only === undefined
                ? "No code repository yet."
                : `${group.name} has no code repository yet.`}
            </Text>
          </div>
        </>
      ) : null}
    </Card>
  );
}

export function ZeropsGitOverview(props: OverviewProps) {
  const { state, visible = true, onAgain, standingOf, questions = [], only } = props;
  const [openOnly, setOpenOnly] = useState(false);
  if (!visible) return null;
  const apps =
    state.kind === "read"
      ? only === undefined
        ? state.apps
        : state.apps.filter((app) => app.appId === only)
      : [];
  const openQuestions = questions
    .map(({ question }) => question)
    .filter((question) => only === undefined || question.appId === only);
  const all = gitOverviewGroups(apps, (id) => standingOf(id).standing, false, openQuestions);
  const filtering = openOnly && all.openChanges > 0;
  const groups = filtering
    ? gitOverviewGroups(apps, (id) => standingOf(id).standing, true, openQuestions)
    : all;
  const groupProps = {
    standingOf,
    questions,
    answer: props.answer,
    onAddMate: props.onAddMate,
    onDelete: props.onDelete,
    onReview: props.onReview,
    repositoryHref: props.repositoryHref,
    onOpenRepository: props.onOpenRepository,
    only,
  };
  if (only !== undefined)
    return (
      <div className="flex flex-col gap-4" data-zerops-surface="git-overview">
        {state.kind === "refused" ? (
          <p
            className="text-body text-status-failed"
            role="alert"
            data-zerops-surface="git-refused"
          >
            {state.reason}
          </p>
        ) : (
          <ReadTrouble failure={state.failure} onAgain={onAgain} />
        )}
        {[...all.used, ...all.kept].map((group) => (
          <ProjectGroup key={group.appId} group={group} {...groupProps} />
        ))}
        {(state.kind === "unread" && state.failure === null) ||
        (state.kind === "read" && state.reading) ? (
          <Reading />
        ) : null}
      </div>
    );
  return (
    <div className="flex flex-col gap-5" data-zerops-surface="git-overview">
      {state.kind === "refused" ? (
        <p className="text-body text-status-failed" role="alert" data-zerops-surface="git-refused">
          {state.reason}
        </p>
      ) : (
        <ReadTrouble failure={state.failure} onAgain={onAgain} />
      )}
      {state.kind === "read" &&
      state.failure !== null &&
      state.apps.some((app) => app.repositories.some((repo) => repo.coverage !== "unread")) ? (
        <Text render={<p />} variant="note">
          Showing the last read changes.
        </Text>
      ) : null}
      {state.kind === "read" &&
        state.refusals?.map(({ appId, name, reason }) => (
          <Text render={<p />} variant="description" key={appId} role="status">
            {name}: {reason}
          </Text>
        ))}
      {all.projects > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="description">
            {all.projects} {all.projects === 1 ? "project" : "projects"} · {all.repositories}{" "}
            {all.repositories === 1 ? "repository" : "repositories"} · {all.openChanges} open{" "}
            {all.openChanges === 1 ? "change" : "changes"}
          </Text>
          {all.openChanges > 0 ? (
            <InlineButton aria-pressed={filtering} onClick={() => setOpenOnly(!filtering)}>
              {filtering ? "show all" : "show only these"}
            </InlineButton>
          ) : null}
        </div>
      ) : null}
      {groups.used.length > 0 ? (
        <section aria-label="Projects" className="flex flex-col gap-3">
          {groups.used.map((group) => (
            <ProjectGroup key={group.appId} group={group} {...groupProps} />
          ))}
        </section>
      ) : null}
      {groups.kept.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Kept code">
          <div className="flex flex-col gap-1">
            <Text render={<h2 />} variant="label">
              Kept code
            </Text>
            <Text variant="description">
              Nobody works on these projects. Their code is billed as storage.
            </Text>
          </div>
          {groups.kept.map((group) => (
            <ProjectGroup key={group.appId} group={group} {...groupProps} />
          ))}
        </section>
      ) : null}
      {state.kind === "read" &&
      all.projects === 0 &&
      groups.kept.length === 0 &&
      !state.reading &&
      state.failure === null ? (
        <div className="flex flex-col gap-2" data-zerops-surface="git-empty">
          <Text render={<p />} variant="description">
            No code yet. A project's repositories appear here once its first Mate is set up.
          </Text>
          <div>
            <Button render={<a href={`${appBasePath()}/zerops`} />} size="sm" variant="link">
              Open Projects
            </Button>
          </div>
        </div>
      ) : null}
      {(state.kind === "unread" && state.failure === null) ||
      (state.kind === "read" && state.reading) ? (
        <Reading />
      ) : null}
    </div>
  );
}

/** The project's code has the same project door and standing wherever it is opened. */
export function ProjectCodeHeading({
  appId,
  name,
  view,
  sentence,
  onOpenProject,
  onAddMate,
  onDelete,
  onReview,
}: {
  readonly appId: string;
  readonly name: string;
  readonly view: CodeStandingView;
  readonly sentence: string | undefined;
  readonly onOpenProject?: (() => void) | undefined;
  readonly onAddMate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onReview?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={name}
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
          view.standing.kind === "in-use" ? (
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
          ) : undefined
        }
      />
      {sentence === undefined ? null : (
        <>
          <Text render={<p />} variant="description">
            {sentence}
          </Text>
          <CodeStandingActions
            name={name}
            view={view}
            onAddMate={onAddMate}
            onDelete={onDelete}
            onReview={onReview}
          />
        </>
      )}
    </div>
  );
}

export function ProjectCodeGone() {
  return (
    <div className="flex flex-col items-start gap-2">
      <InPhoneBar>
        <WorkspaceBreadcrumb ariaLabel="Project code">
          <WorkspaceBreadcrumbItem>
            <GitBrowserLink to={{}} tone="muted">
              Git
            </GitBrowserLink>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </InPhoneBar>
      <Text render={<p />} variant="description">
        This project is not here: it was deleted or your access was removed.
      </Text>
      <GitBrowserLink to={{}}>Back to Git</GitBrowserLink>
    </div>
  );
}

export function ZeropsGitPage() {
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
  const structure = useHqStructure();
  const addMate = useAddMate();
  const inventory = useContext(InventoryContext);
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
    appsKnown: !registry.loading,
    apps: selectedApp === undefined ? [] : [selectedApp],
    failure: flow.readFailure ?? inventory?.error ?? undefined,
    mateName: (projectId) => mateNames.get(projectId),
  });
  const selectedStanding = search.appId === undefined ? undefined : standingOf(search.appId);
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
    const group = registry.registry.groups.find(({ groupId }) => groupId === appId);
    const app = structure?.apps.find(({ id }) => id === appId);
    if (group !== undefined && app !== undefined)
      useDeleteApplicationDialog.getState().open({
        target: lastMateDeletionTarget(inventory?.projects ?? [], app),
      });
  };

  return (
    <ZeropsHostedFrame bar={false} width="full">
      {detailOpen || projectOpen ? null : (
        <InPhoneBar>
          <PageHeader
            actions={
              <Button variant="ghost" size="sm" onClick={readAgain}>
                Read again
              </Button>
            }
            data-zerops-surface="git-header"
            line="Your organisation's code, by project."
            title="Git"
          />
        </InPhoneBar>
      )}
      {projectOpen && search.appId !== undefined && selectedStanding !== undefined ? (
        !registry.loading && selectedApp === undefined ? (
          <ProjectCodeGone />
        ) : (
          <ProjectCodeHeading
            appId={search.appId}
            name={selectedApp?.name ?? "Project"}
            view={selectedStanding}
            sentence={sentence}
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
      <div hidden={detailOpen || (projectOpen && !registry.loading && selectedApp === undefined)}>
        <div className="flex flex-col gap-4">
          <ZeropsGitOverview
            key={activeOrganization?.id ?? "unscoped"}
            visible={!detailOpen}
            only={projectOpen ? search.appId : undefined}
            onAgain={readAgain}
            standingOf={standingOf}
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
            state={projectOpen ? projectState : state}
          />
        </div>
      </div>
    </ZeropsHostedFrame>
  );
}
