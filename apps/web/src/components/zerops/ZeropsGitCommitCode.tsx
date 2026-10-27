/**
 * A commit's files and lines, drawn by the code view Diff uses — loaded on demand with the diff
 * renderer, so the Git tab carries none of it until a commit is opened.
 */
import type { EnvironmentId, ReviewDiffPreviewSource, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useDiffPanelStore } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { createGitDiffFileContentsLoader } from "~/lib/diffFileContents";
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { reviewEnvironment } from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";

import { AnnotatableCodeView } from "../diffs/AnnotatableCodeView";
import { Button } from "../ui/button";

export default function ZeropsGitCommitCode({
  environmentId,
  cwd,
  source,
  sectionId,
  sectionTitle,
  composerDraftTarget,
}: {
  readonly environmentId: EnvironmentId;
  /** The checkout the commit was read from; its files expand from there. */
  readonly cwd: string;
  readonly source: ReviewDiffPreviewSource;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly composerDraftTarget: ScopedThreadRef;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings().wordWrap;
  const diffRenderMode = useDiffPanelStore((state) => state.diffRenderMode);
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const patch = useMemo(
    () => getRenderablePatch(source.diff, `git-commit:${resolvedTheme}`),
    [source.diff, resolvedTheme],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const files = useMemo(
    () =>
      patch?.kind === "files"
        ? patch.files
            .toSorted((left, right) =>
              resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
                numeric: true,
                sensitivity: "base",
              }),
            )
            .map((fileDiff) => {
              const fileKey = buildFileDiffRenderKey(fileDiff);
              return {
                fileDiff,
                fileKey,
                filePath: resolveFileDiffPath(fileDiff),
                collapsed: collapsed.has(fileKey),
              };
            })
        : [],
    [patch, collapsed],
  );
  const loadDiffFiles = useMemo(
    () =>
      createGitDiffFileContentsLoader(getDiffFileContents, {
        environmentId,
        cwd,
        sourceKind: source.kind,
        baseRef: source.baseRef,
        headRef: source.headRef,
        cacheKey: source.diffHash,
      }),
    [cwd, environmentId, getDiffFileContents, source],
  );

  return (
    <>
      {source.truncated ? (
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
          This commit is larger than the preview limit; the changes shown are incomplete.
        </p>
      ) : null}
      {patch?.kind === "raw" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="text-xs text-muted-foreground">{patch.reason}</p>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">{patch.text}</pre>
        </div>
      ) : (
        <AnnotatableCodeView
          className="min-h-0 flex-1 overflow-auto"
          codeViewKey={sectionId}
          composerDraftTarget={composerDraftTarget}
          files={files}
          options={{
            diffStyle: diffRenderMode === "split" ? "split" : "unified",
            lineDiffType: "none",
            overflow: wordWrap ? "wrap" : "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme,
            stickyHeaders: true,
            loadDiffFiles,
          }}
          renderHeaderPrefix={(fileDiff, key, isCollapsed) => (
            <Button
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${resolveFileDiffPath(fileDiff)}`}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              size="icon-sm"
              variant="ghost"
            >
              {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            </Button>
          )}
          sectionId={sectionId}
          sectionTitle={sectionTitle}
        />
      )}
    </>
  );
}
