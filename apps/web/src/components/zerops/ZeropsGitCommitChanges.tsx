/**
 * One commit's changes, opened from its row on the Git tab: its files and lines in the code view
 * Diff draws, read from the checkout the commit lives in (`review.getDiffPreview` with `commit`).
 * On a Mate that checkout is a dev service's, so the read is that service's own git over ssh.
 *
 * It takes the tab's place rather than opening Diff: the list it came from is one press back.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { appChunk } from "~/lib/appChunks";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { checkoutPathFor } from "~/zerops/useZeropsGitRemoteProbe";

import { DiffPanelLoadingState } from "../DiffPanelShell";
import { Button } from "../ui/button";
import { GitBrowserLink, gitCommitLink } from "./gitBrowser/GitBrowserLink";
import { commitChangesState, type CommitChangesState } from "./ZeropsGitCommitChanges.logic";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

const ZeropsGitCommitCode = lazy(appChunk(() => import("./ZeropsGitCommitCode")));

export interface OpenGitCommit {
  readonly repository: string;
  readonly sha: string;
  readonly subject: string;
}

export function ZeropsGitCommitChanges({
  appId,
  environmentId,
  commit,
  composerDraftTarget,
  onBack,
}: {
  /** The Mate's application at HQ, whose copy holds a commit the checkout lost. */
  readonly appId: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly commit: OpenGitCommit;
  readonly composerDraftTarget: ScopedThreadRef;
  readonly onBack: () => void;
}) {
  const cwd = checkoutPathFor(commit.repository);
  const query = useEnvironmentQuery(
    reviewEnvironment.diffPreview({ environmentId, input: { cwd, commit: commit.sha } }),
  );
  return (
    <ZeropsGitCommitView
      appId={appId}
      commit={commit}
      composerDraftTarget={composerDraftTarget}
      cwd={cwd}
      environmentId={environmentId}
      onBack={onBack}
      onRetry={query.refresh}
      state={commitChangesState(query, commit.sha)}
    />
  );
}

/** The commit's page for a state of its read: what the Git tab draws, apart from reading it. */
export function ZeropsGitCommitView({
  appId,
  environmentId,
  commit,
  cwd,
  state,
  composerDraftTarget,
  onBack,
  onRetry,
}: {
  readonly appId: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly commit: OpenGitCommit;
  readonly cwd: string;
  readonly state: CommitChangesState;
  readonly composerDraftTarget: ScopedThreadRef;
  readonly onBack: () => void;
  readonly onRetry: () => void;
}) {
  const short = commit.sha.slice(0, 7);
  const loading = <DiffPanelLoadingState label="Loading commit…" />;

  return (
    <section
      aria-label={`Commit ${short}`}
      className="flex min-h-0 flex-1 flex-col"
      data-zerops-surface="git-commit-changes"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button aria-label="Back to commits" onClick={onBack} size="icon-sm" variant="ghost">
          <ArrowLeftIcon />
        </Button>
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">{short}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{commit.subject}</span>
      </header>
      {state.kind === "loading" ? (
        loading
      ) : state.kind === "changes" ? (
        <Suspense fallback={loading}>
          <ZeropsGitCommitCode
            composerDraftTarget={composerDraftTarget}
            cwd={cwd}
            environmentId={environmentId}
            sectionId={`git-commit:${commit.repository}:${commit.sha}`}
            sectionTitle={`Commit ${short}`}
            source={state.source}
          />
        </Suspense>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
          {state.kind === "empty" ? (
            <p>This commit changed no files.</p>
          ) : state.kind === "absent" ? (
            <>
              <p>This commit is not in the checkout any more.</p>
              {appId === undefined ? null : (
                <GitBrowserLink to={gitCommitLink({ appId, repo: commit.repository }, commit.sha)}>
                  Open it in Git
                </GitBrowserLink>
              )}
            </>
          ) : state.kind === "needs-update" ? (
            <>
              <p>This Mate shows a commit's changes after its next update.</p>
              <ZeropsMateUpdateControl environmentId={environmentId}>
                {({ line }) => line}
              </ZeropsMateUpdateControl>
            </>
          ) : (
            <>
              <p>Couldn't read this commit's changes.</p>
              <Button onClick={onRetry} size="sm" variant="secondary">
                Try again
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
