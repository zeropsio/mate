/**
 * The top of the Code page: where this Mate's work is, above what changed (`CodePage`).
 *
 * First the page's title, with the way to the project's page, and the project's line for this Mate
 * (`ProjectLine`, compact): its stations, this Mate's changes as beads — work on disk that is no
 * change yet among them — everybody else's as a count, and *Review release* where one waits. Then
 * per code repository it works in, under its name and its state on
 * GitHub, this Mate's work as a change row in plain words ("1 file not committed yet", "Ready to
 * merge", "Merged · waits for production"). The change's commits and its files are the page's
 * "What changed", below.
 *
 * A repository whose remote does not answer says so on its own line, in its GitHub state's place,
 * with *Check again* and what git said folded under *Details*; its rows stay its changes.
 *
 * The project's flow was once left out on purpose: a tab that carried the project's stage,
 * production and releases read as "git for the whole project" in a Mate's own panel (the owner,
 * 2026-09-17). The pages pass reversed that (the owner, 2026-11-09): a panel that names a Mate's
 * change and never says where it goes is a dead end, so the places are here — the project's line,
 * each place opening its page, with the project's page one press away. The rest of the flow
 * (releases, history, recipe changes) stays on the project's pages.
 *
 * Every fact comes from the party that can prove it, and each one arrives on its own schedule: the
 * checkout is a live subscription, and the Mate's change comes down HQ's stream. Nothing here
 * decides anything — `gitTab.ts` and `matePanels.logic.ts` do, and this renders what they produced
 * (R5). It draws no scroller of its own: it stands in the page's.
 */
import {
  NO_REPOSITORY_LINE,
  type FlowPullRequest,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InlineButton } from "~/components/ui/button";
import { FailureDetails } from "~/components/ui/failure";
import type { RepoState } from "./gitMirror.logic";
import { possessive, WORK_AWAITS_REPOSITORY, type GitWorkRow } from "./matePanels.logic";
import type { MatePanelProject } from "./MatePanelPlaces";
import {
  ChangeList,
  ChangeRow,
  ProjectLine,
  SectionAction,
  SectionLabel,
  type ProjectLineView,
} from "./system";

/** One code repository the Mate works in, as the tab draws it. */
export interface ZeropsGitRepository {
  readonly block: GitBlock;
  /** This Mate's work in it, as rows (`gitWorkRows`). */
  readonly work: ReadonlyArray<GitWorkRow>;
  /** Its state on GitHub (`repoState`), where HQ lists the repository. */
  readonly github?: RepoState | undefined;
  /** Whether its remote answers is being asked again: the line says so in the verb's place. */
  readonly checking?: boolean | undefined;
}

export interface ZeropsGitPanelModel {
  readonly repositories: ReadonlyArray<ZeropsGitRepository>;
  /** What it says while there is no repository (`gitEmptyLine`); no repository yet when absent. */
  readonly emptyLine?: string;
}

export interface ZeropsGitPanelProps {
  readonly model: ZeropsGitPanelModel;
  /** The Mate's project, once known: the way to its page, and its release's review. */
  readonly project?: MatePanelProject | undefined;
  /**
   * The project's line for this Mate (`projectLine` with `mine` and its work on disk); `undefined`
   * while the project's flow is unread: its card holds its room.
   */
  readonly line?: ProjectLineView | undefined;
  /** Whose work it is, as every surface names the Mate. */
  readonly mateName?: string | undefined;
  /** The Mate's face, small, at the start of each of its rows. */
  readonly mateFace?: ReactNode;
  /** The verb at the end of a repository's work — already gated (`gitActionAllowed`). */
  readonly renderBlockAction?: (block: GitBlock) => ReactNode;
  /** Opens a change's sheet from its row: its review while open, what it became once landed. */
  readonly onOpenChange?: ((block: GitBlock, from: HTMLElement) => void) | undefined;
  /** Opens a change's sheet from its bead on the line. */
  readonly onOpenPull?: ((pull: FlowPullRequest, from: HTMLElement) => void) | undefined;
  /** Opens the dialog that connects a repository to GitHub. */
  readonly onConnect?: ((repository: string) => void) | undefined;
  /** Asks again whether a repository's remote answers; no *Check again* without it. */
  readonly onCheckAgain?: ((block: GitBlock) => void) | undefined;
}

export function ZeropsGitPanel({
  model,
  project,
  line,
  mateName,
  mateFace,
  renderBlockAction,
  onOpenChange,
  onOpenPull,
  onConnect,
  onCheckAgain,
}: ZeropsGitPanelProps) {
  const { repositories } = model;
  return (
    // Its sections stand in the page's column, spaced as the page spaces its own.
    <div className="contents" data-zerops-surface="git-panel">
      {/* Where the work is: the project's line, this Mate's changes on it. */}
      {project === undefined ? null : (
        <section
          aria-label={`${project.name}, ${possessive(mateName ?? "This Mate", "work")}`}
          className="flex min-w-0 flex-col gap-3"
          data-zerops-surface="panel-line"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            {/* The page's own title stands above (the panel's shell draws it): this row names
                whose line it is. */}
            <h2 className="m-0 truncate text-line font-medium text-muted-foreground">
              {project.name}
            </h2>
            <SectionAction onClick={project.onOpenProject}>
              Open project
              <ChevronRightIcon aria-hidden="true" />
            </SectionAction>
          </div>
          <ProjectLine
            groupId={project.groupId}
            onOpenChange={(pull, from) => {
              onOpenPull?.(pull, from);
            }}
            // The way to put it live is the project's page.
            onPutLive={project.onOpenProject}
            onReviewRelease={(from) => {
              project.next?.release.onReview(from);
            }}
            surface="panel"
            view={line}
          />
        </section>
      )}
      {repositories.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3.5 text-body text-muted-foreground">
          {model.emptyLine ?? NO_REPOSITORY_LINE}
        </p>
      ) : (
        repositories.map((repository) => {
          const { block } = repository;
          const troubled = block.trouble.length > 0;
          return (
            <section
              className="flex min-w-0 flex-col gap-2"
              data-zerops-git-block={block.repository}
              data-zerops-git-state={block.state}
              key={block.repository}
            >
              <div className="flex min-w-0 flex-col">
                <SectionLabel
                  action={
                    // What was proved wrong outranks its state on GitHub: one line, the worst first.
                    troubled ? (
                      <TroubleLine
                        checking={repository.checking === true}
                        onCheckAgain={
                          onCheckAgain === undefined ? undefined : () => onCheckAgain(block)
                        }
                        trouble={block.trouble}
                      />
                    ) : repository.github === undefined ? undefined : (
                      <GithubLine
                        onConnect={
                          onConnect === undefined ? undefined : () => onConnect(block.hqRepository)
                        }
                        state={repository.github}
                      />
                    )
                  }
                  level={3}
                >
                  {block.label ?? block.repository}
                </SectionLabel>
                {/* What git said, for whoever reports it: folded, never a row's title. */}
                {!troubled || block.troubleDetail === undefined ? null : (
                  <div className="min-w-0 pb-1" data-zerops-surface="git-trouble-detail">
                    <FailureDetails align="end">{maskSecrets(block.troubleDetail)}</FailureDetails>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-card">
                {repository.work.length === 0 ? (
                  // No change to show while the remote does not answer: the slot says what it holds.
                  <p
                    className="m-0 flex min-h-14 items-center px-4 text-body text-muted-foreground"
                    data-zerops-surface="git-work-awaits"
                  >
                    {WORK_AWAITS_REPOSITORY}
                  </p>
                ) : (
                  <div className="px-3.5 py-1.5">
                    <ChangeList label={possessive(mateName ?? "This Mate", "work")}>
                      {repository.work.map((row, rowIndex) => (
                        <WorkRow
                          block={block}
                          face={mateFace}
                          key={row.kind === "change" ? `#${String(row.pull.number)}` : row.kind}
                          mateName={mateName}
                          onOpenChange={onOpenChange}
                          row={row}
                          // One verb, at the end of the repository's first row.
                          verb={
                            rowIndex === 0 ? (renderBlockAction?.(block) ?? undefined) : undefined
                          }
                        />
                      ))}
                    </ChangeList>
                  </div>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** One row of a repository's work: the Mate's change, or the sentence for work that is none yet. */
function WorkRow({
  row,
  block,
  face,
  mateName,
  verb,
  onOpenChange,
}: {
  readonly row: GitWorkRow;
  readonly block: GitBlock;
  readonly face: ReactNode;
  readonly mateName: string | undefined;
  readonly verb: ReactNode;
  readonly onOpenChange: ((block: GitBlock, from: HTMLElement) => void) | undefined;
}) {
  const whose = (state: string) => (mateName === undefined ? state : `${mateName} · ${state}`);
  if (row.kind === "held")
    // HQ has not told the changes: the row keeps its height, empty, so nothing moves when it does.
    return <li aria-hidden="true" className="h-11" data-zerops-surface="git-work-held" />;
  if (row.kind === "plain")
    return (
      <ChangeRow
        face={face}
        line={mateName ?? block.checkoutLine}
        title={row.title}
        tone={row.tone}
        verb={verb}
      />
    );
  return (
    <ChangeRow
      at={row.at}
      face={face}
      line={whose(row.state)}
      onOpen={
        onOpenChange === undefined
          ? undefined
          : (from) => {
              onOpenChange(block, from);
            }
      }
      open={row.open}
      pull={row.pull}
      tone={row.tone}
      verb={verb}
    />
  );
}

/**
 * A repository whose remote does not answer, at its label's end: "Can't reach the repository" with
 * *Check again*, or that it is being checked. The sentence gives way in a narrow panel; the verb
 * never does.
 */
function TroubleLine({
  trouble,
  checking,
  onCheckAgain,
}: {
  readonly trouble: string;
  readonly checking: boolean;
  readonly onCheckAgain: (() => void) | undefined;
}) {
  return (
    <span
      className="flex min-w-0 items-baseline gap-1 text-caption text-muted-foreground"
      data-zerops-surface="git-trouble"
      role="status"
    >
      <span className="min-w-0 truncate text-status-failed-text">{trouble}</span>
      {onCheckAgain === undefined ? null : (
        <span className="flex shrink-0 items-baseline gap-1">
          <span aria-hidden="true">·</span>
          {checking ? (
            <span>Checking…</span>
          ) : (
            <InlineButton data-zerops-surface="git-trouble-check" onClick={onCheckAgain}>
              Check again
            </InlineButton>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * A repository's state on GitHub, at its label's end: "Not on GitHub · Connect", "In sync · pushed
 * 2h ago", or why it stopped with *Reconnect*. The words give way in a narrow panel; the verb that
 * fixes them never does.
 */
function GithubLine({
  state,
  onConnect,
}: {
  readonly state: RepoState;
  readonly onConnect: (() => void) | undefined;
}) {
  const verb =
    onConnect === undefined
      ? undefined
      : state.fix === "connect"
        ? "Connect"
        : state.fix === "reconnect"
          ? "Reconnect"
          : undefined;
  return (
    <span
      className="flex min-w-0 items-baseline gap-1 text-caption text-muted-foreground"
      data-zerops-surface="git-github"
    >
      <span className="min-w-0 truncate">{state.line}</span>
      {verb === undefined ? null : (
        <span className="flex shrink-0 items-baseline gap-1">
          <span aria-hidden="true">·</span>
          <InlineButton data-zerops-surface="git-github-connect" onClick={onConnect}>
            {verb}
          </InlineButton>
        </span>
      )}
    </span>
  );
}
