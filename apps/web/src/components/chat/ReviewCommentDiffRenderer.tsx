import { CodeBlock } from "~/components/ui/code-block";
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import { FileDiff } from "@pierre/diffs/react";
import { getRenderablePatch, resolveFileDiffPath } from "../../lib/diffRendering";
import {
  buildReviewCommentRenderablePatch,
  type ReviewCommentContext,
} from "../../reviewCommentContext";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { ReviewCommentDiffLoading } from "./ReviewCommentDiffLoading";

export default function ReviewCommentDiffRenderer({
  comment,
  theme,
}: {
  comment: ReviewCommentContext;
  theme: "light" | "dark";
}) {
  const renderablePatch = getRenderablePatch(
    buildReviewCommentRenderablePatch(comment),
    `review-comment:${comment.id}`,
  );
  if (renderablePatch?.kind === "files") {
    return (
      <DiffWorkerPoolProvider loadingFallback={<ReviewCommentDiffLoading patch={comment.diff} />}>
        {renderablePatch.files.map((fileDiff) => (
          <FileDiff
            key={resolveFileDiffPath(fileDiff)}
            fileDiff={fileDiff}
            options={{ collapsed: false, diffStyle: "unified", theme: resolveDiffThemeName(theme) }}
          />
        ))}
      </DiffWorkerPoolProvider>
    );
  }
  if (renderablePatch?.kind === "raw") {
    return <CodeBlock wrap={false}>{renderablePatch.text}</CodeBlock>;
  }
  return null;
}
