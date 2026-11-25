import { Loading } from "../ui/loading";

/** The comment's patch as plain text while its highlighted diff is on its way. */
export function ReviewCommentDiffLoading({ patch }: { patch: string }) {
  return (
    <Loading label="The diff">
      <pre className="overflow-x-auto rounded-control bg-muted/40 p-2 text-caption">{patch}</pre>
    </Loading>
  );
}
