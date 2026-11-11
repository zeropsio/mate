/**
 * The top of the Code page: where this Mate's work is, above what changed (`CodePage`).
 *
 * First the project, as the Zerops panel opens with it (`MateProjectCard`): its places and what
 * waits for production; under it the project's line as a picture for this Mate (`ProjectLine`):
 * its changes as beads between the project's stations, work on disk that is no change yet among
 * them, everybody else's as a count; its corner leads to the project's page with the line in full.
 * Then per code repository it works in, under its service's hostname — a real name, in the face
 * of names — with where its code goes on GitHub and how that stands, this Mate's work as a change
 * row in plain words ("1 file not committed yet", "Ready to
 * merge", "Merged · waits for production"). The change's commits and its files are the page's
 * "What changed", below.
 *
 * A repository whose remote does not answer says so on its own line, in its GitHub state's place,
 * with *Check again* and what git said folded under *Details*; its rows stay its changes.
 *
 * The project's flow was once left out on purpose: a tab that carried the project's stage,
 * production and releases read as "git for the whole project" in a Mate's own panel (the owner,
 * 2026-09-17). The pages pass reversed that (the owner, 2026-11-09): a panel that names a Mate's
 * change and never says where it goes is a dead end, so the places are here — the same lines the
 * project's pages show, each opening its place, with the project's page one press away. The rest of
 * the flow (releases, history, recipe changes) stays on the project's pages.
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
import { GitBranchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { GitHubIcon } from "~/components/Icons";
import { Badge } from "~/components/ui/badge";
import { InlineButton } from "~/components/ui/button";
import { FailureDetails } from "~/components/ui/failure";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import type { RepoState } from "./gitMirror.logic";
import { possessive, WORK_AWAITS_REPOSITORY, type GitWorkRow } from "./matePanels.logic";
import { MateProjectCard, type MatePanelProject } from "./MatePanelPlaces";
import { ChangeList, ChangeRow, ProjectLine, type ProjectLineView } from "./system";

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
  /** The Mate's project, once known: its places and the way to its page. */
  readonly project?: MatePanelProject | undefined;
  /**
   * The project's line for this Mate (`projectLine` with `mine` and its work on disk); `undefined`
   * while the project's flow is unread: its picture holds its room.
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
  /**
   * *Show the full picture*, pressed: the picture's corner leads to the project's page, which is
   * to arrive with the line in full (a panel has no room for it).
   */
  readonly onShowFullPicture?: (() => void) | undefined;
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
  onShowFullPicture,
  onConnect,
  onCheckAgain,
}: ZeropsGitPanelProps) {
  const { repositories } = model;
  return (
    // Its sections stand in the page's column, spaced as the page spaces its own.
    <div className="contents" data-zerops-surface="git-panel">
      {/* The project and where the work goes: the same card the Zerops panel opens with. */}
      {project === undefined ? null : (
        // The card stands first, where the Zerops panel's does; the picture of this Mate's
        // changes hugs it.
        <div className="flex min-w-0 flex-col gap-3">
          <MateProjectCard mateName={mateName} project={project} />
          <ProjectLine
            full={{
              kind: "page",
              groupId: project.groupId,
              onOpen: () => {
                onShowFullPicture?.();
              },
            }}
            onOpenChange={(pull, from) => {
              onOpenPull?.(pull, from);
            }}
            surface="panel"
            view={line}
          />
        </div>
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
                {/* One line while it fits; a long reason takes the next, whole, never cut. */}
                <div
                  className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 py-1"
                  data-zerops-surface="git-repository-head"
                >
                  {/* A service's own name, in the face of names: never the section labels' face. */}
                  <h3 className="m-0 min-w-0 truncate font-mono text-caption font-medium text-foreground">
                    {block.label ?? block.repository}
                  </h3>
                  <Destination to={repository.github?.destination ?? null} />
                  {/* What was proved wrong outranks its state on GitHub: one line, the worst first. */}
                  {troubled ? (
                    <TroubleLine
                      checking={repository.checking === true}
                      onCheckAgain={
                        onCheckAgain === undefined ? undefined : () => onCheckAgain(block)
                      }
                      trouble={block.trouble}
                    />
                  ) : repository.github === undefined ? null : (
                    <GithubLine
                      onConnect={
                        onConnect === undefined ? undefined : () => onConnect(block.hqRepository)
                      }
                      state={repository.github}
                    />
                  )}
                </div>
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
 * Where a repository's code goes, after its name: `acme/tea-shop` under GitHub's mark, as the
 * project page's Code card names it; nothing while it goes nowhere.
 */
function Destination({ to }: { readonly to: RepoState["destination"] }) {
  if (to === null) return null;
  const Mark = to.href.startsWith("https://github.com/") ? GitHubIcon : GitBranchIcon;
  return (
    <a
      className="inline-flex min-w-0 items-center gap-1 rounded-sm text-caption text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      data-zerops-surface="git-destination"
      href={to.href}
      rel="noreferrer"
      target="_blank"
    >
      <Mark aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{to.label}</span>
    </a>
  );
}

/**
 * A repository's state and the verb that answers it, together: beside its name while they fit,
 * else on the next line, where the words wrap and the verb keeps the line's end edge.
 */
const STATE = "flex min-w-0 flex-auto items-start gap-x-2.5";
/** The one verb a repository's line ends in, at the line's end edge. */
const VERB = "ms-auto flex shrink-0 items-center text-caption text-muted-foreground";

/**
 * A repository whose remote does not answer, in its GitHub state's place: "Can't reach the
 * repository", with *Check again* at the line's end, or that it is being checked.
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
    <span className={STATE}>
      <span
        className="min-w-0 text-caption text-status-failed-text"
        data-zerops-surface="git-trouble"
        role="status"
      >
        {trouble}
      </span>
      {onCheckAgain === undefined ? null : (
        <span className={VERB}>
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

/** A state's ink and the tone of its mark, as the Code card's row says it. */
const STATE_INK = {
  ok: "text-muted-foreground",
  warn: "text-status-attention-text",
  bad: "text-status-failed-text",
} as const;
const STATE_MARK = { ok: "success", warn: "warning", bad: "danger" } as const;

/**
 * A repository's state on GitHub, after where its code goes: "Not on GitHub", "In sync · pushed 2h
 * ago" under its mark, or why it stopped; the verb that fixes it (*Connect*, *Reconnect*) at the
 * line's end.
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
    <span className={STATE}>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-caption",
          state.tone === "busy" || state.tone === "quiet"
            ? "text-muted-foreground"
            : STATE_INK[state.tone],
        )}
        data-zerops-surface="git-github"
      >
        {state.tone === "busy" ? (
          <>
            <Spinner aria-hidden="true" size="xs" />
            {state.line}
          </>
        ) : state.tone === "quiet" ? (
          state.line
        ) : (
          <Badge dot tone={STATE_MARK[state.tone]} wrap>
            {state.line}
          </Badge>
        )}
      </span>
      {verb === undefined ? null : (
        <span className={VERB}>
          <InlineButton data-zerops-surface="git-github-connect" onClick={onConnect}>
            {verb}
          </InlineButton>
        </span>
      )}
    </span>
  );
}
