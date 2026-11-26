import { ChevronRightIcon, FileCogIcon, FolderGit2Icon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import {
  codeStandingLine,
  codeStandingSentence,
  gitChangesStatus,
  gitOverviewGroups,
  gitStandingNotice,
  type GitOverviewRepository,
} from "@t3tools/client-runtime/zerops";
import type { HqMateIdentity, KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { formatStorageBytes } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import { appBasePath } from "~/basePath";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { CodeStandingView } from "~/zerops/useCodeStandings";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Card } from "../ui/card";
import { Dot } from "../ui/dot";
import { Failure } from "../ui/failure";
import { LogoTile } from "../ui/logo-tile";
import { Row } from "../ui/row";
import { Text } from "../ui/text";
import { CodeStandingActions } from "./CodeStandingActions";
import { KeptCodeQuestion } from "./KeptCodeQuestion";
import { repositoryWhere } from "./ZeropsGitPage.logic";
import { MateFace } from "./primitives";
import { STATUS_BADGE_TONE } from "./primitives/statusBadgeTone";

export type GitGroup = ReturnType<typeof gitOverviewGroups>["groups"][number];
export type GitLinks = {
  readonly repositoryHref?: ((appId: string, repo: string, view?: "changes") => string) | undefined;
  readonly onOpenRepository?: ((appId: string, repo: string, view?: "changes") => void) | undefined;
};

type CardProps = GitLinks & {
  readonly group: GitGroup;
  readonly view: CodeStandingView;
  readonly question?: KeptGitQuestionView | undefined;
  readonly answer?: ((choice: "keep" | "delete") => Promise<void>) | undefined;
  readonly onAddMate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onReview?: (() => void) | undefined;
  readonly onOpenProject?: (() => void) | undefined;
  readonly chief?: { readonly identity?: HqMateIdentity | undefined } | undefined;
};

function intercept(event: MouseEvent, action: (() => void) | undefined) {
  if (
    action === undefined ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  event.preventDefault();
  action();
}

export function GitStandingBadge({ standing }: { readonly standing: GitGroup["standing"] }) {
  const notice = gitStandingNotice(standing);
  return notice === undefined ? null : (
    <Badge tone={STATUS_BADGE_TONE[notice.tone]}>{notice.words}</Badge>
  );
}

export function gitGroupFacts(group: GitGroup): string {
  const count =
    group.repositoryCount === 0
      ? "No code repository"
      : group.repositoryCount === 1
        ? "1 repository"
        : `${String(group.repositoryCount)} repositories`;
  return count + (group.size.complete ? ` · ${formatStorageBytes(group.size.bytes)}` : "");
}

export function GitSetup({
  group,
  repositoryHref,
  onOpenRepository,
}: GitLinks & { readonly group: GitGroup }) {
  if (group.setup === undefined) return null;
  const status = gitChangesStatus(group.setup.changes);
  const href = repositoryHref?.(group.appId, "group");
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      render={<a href={href} />}
      onClick={(event) =>
        intercept(
          event,
          onOpenRepository === undefined ? undefined : () => onOpenRepository(group.appId, "group"),
        )
      }
    >
      <FileCogIcon />
      Setup{status === undefined ? "" : ` · ${String(status.open)} open`}
    </Button>
  );
}

const REPOSITORY_GRID =
  "grid grid-cols-[minmax(11rem,1.15fr)_minmax(10rem,1fr)_minmax(13rem,1.2fr)_5.5rem_5rem_1rem] gap-x-6 gap-y-0.5 p-1.5 [--row-pad-x:--spacing(3.5)] [--row-pad-y:--spacing(2.5)]";

export function GitRepositoryRows({
  appId,
  repositories,
  repositoryHref,
  onOpenRepository,
}: GitLinks & {
  readonly appId: string;
  readonly repositories: ReadonlyArray<GitOverviewRepository>;
}) {
  return (
    <div className="overflow-x-auto">
      <div className={REPOSITORY_GRID} role="list">
        {repositories.map((repository) => {
          const href = repositoryHref?.(appId, repository.name);
          const changesHref = repositoryHref?.(appId, repository.name, "changes");
          const status = gitChangesStatus(repository.changes);
          const openRow = () => {
            if (onOpenRepository !== undefined) onOpenRepository(appId, repository.name);
            else if (href !== undefined) window.location.assign(href);
          };
          return (
            <Row
              columns
              className="items-center"
              key={repository.name}
              pressable
              role="link"
              tabIndex={0}
              data-zerops-git-app={appId}
              data-zerops-git-repository={repository.name}
              onClick={(event) => {
                if (!(event.target as Element).closest("a,button")) openRow();
              }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && event.key === "Enter") openRow();
              }}
            >
              <span className="flex min-w-0 items-center gap-3">
                <LogoTile size="sm">
                  <FolderGit2Icon />
                </LogoTile>
                <Text truncate variant="heading">
                  <InlineButton
                    tone="plain"
                    render={<a href={href} />}
                    onClick={(event) =>
                      intercept(
                        event,
                        onOpenRepository === undefined
                          ? undefined
                          : () => onOpenRepository(appId, repository.name),
                      )
                    }
                  >
                    {repository.name}
                  </InlineButton>
                </Text>
              </span>
              <span className="min-w-0 break-words">
                <Text variant="description">{repositoryWhere(repository.facts)}</Text>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {repository.coverage === "unread" ? (
                  <Text variant="meta">Changes not read yet.</Text>
                ) : status === undefined ? null : (
                  <InlineButton
                    className="min-w-0 max-w-full shrink"
                    tone="plain"
                    render={<a href={changesHref} />}
                    onClick={(event) =>
                      intercept(
                        event,
                        onOpenRepository === undefined
                          ? undefined
                          : () => onOpenRepository(appId, repository.name, "changes"),
                      )
                    }
                  >
                    <Badge tone="info">{status.open} open</Badge>
                    <Dot tone={STATUS_BADGE_TONE[status.tone]} />
                    <span className="min-w-0 whitespace-normal break-words">
                      <Text variant="meta">{status.words}</Text>
                    </span>
                  </InlineButton>
                )}
              </span>
              <Text variant="meta">
                {repository.facts === undefined
                  ? undefined
                  : formatRelativeTimeLabel(repository.facts.updatedAt)}
              </Text>
              <span className="text-end">
                <Text variant="meta">
                  {repository.facts?.usedBytes === undefined
                    ? undefined
                    : formatStorageBytes(repository.facts.usedBytes)}
                </Text>
              </span>
              <Text variant="meta">
                <ChevronRightIcon aria-hidden className="size-4" />
              </Text>
            </Row>
          );
        })}
      </div>
    </div>
  );
}

export default function GitProjectCard(props: CardProps) {
  const { group, view, question, answer, chief } = props;
  const { standing } = group;
  const line =
    codeStandingSentence(group.name, standing) ??
    (standing.kind === "unread" ? codeStandingLine(standing)?.words : undefined);
  const projectHref = `${appBasePath()}/git?${new URLSearchParams({ appId: group.appId })}`;
  const card = (presses?: ReactNode, lines?: ReactNode) => (
    <Card
      data-git-project={group.appId}
      {...(standing.kind === "asked"
        ? { variant: "wash" as const, tone: "attention" as const }
        : { variant: "sheet" as const })}
    >
      <div className="flex flex-col gap-1 px-5 pt-4 pb-2">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {chief?.identity === undefined ? null : (
              <MateFace
                size={24}
                state="idle"
                tint={chief.identity.tint}
                shape={chief.identity.shape}
              />
            )}
            <Text render={<h3 />} truncate variant="headline">
              <InlineButton
                tone="plain"
                render={<a href={projectHref} />}
                onClick={(event) => intercept(event, props.onOpenProject)}
              >
                {group.name}
              </InlineButton>
            </Text>
            <GitStandingBadge standing={standing} />
            {group.listed ? <Text variant="meta">{gitGroupFacts(group)}</Text> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {question !== undefined ? (
              presses
            ) : standing.kind === "in-use" || standing.kind === "unread" ? (
              <GitSetup
                group={group}
                repositoryHref={props.repositoryHref}
                onOpenRepository={props.onOpenRepository}
              />
            ) : (
              <CodeStandingActions
                name={group.name}
                view={view}
                onAddMate={props.onAddMate}
                onDelete={props.onDelete}
                onReview={props.onReview}
              />
            )}
          </div>
        </div>
        {chief === undefined ? null : <Text variant="description">The Chief Mate's own code.</Text>}
        {line === undefined ? null : <Text variant="description">{line}</Text>}
        {lines}
        {view.stopped === undefined ? null : <Failure size="line" cause={view.stopped} />}
      </div>
      {group.repositories.length === 0 ? (
        <div className="h-2" />
      ) : (
        <GitRepositoryRows appId={group.appId} repositories={group.repositories} {...props} />
      )}
    </Card>
  );
  return question === undefined ? (
    card()
  ) : (
    <KeptCodeQuestion view={question} answer={answer}>
      {({ presses, lines }) => card(presses, lines)}
    </KeptCodeQuestion>
  );
}
