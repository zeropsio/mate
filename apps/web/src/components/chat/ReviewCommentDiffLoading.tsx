import { CodeBlock } from "~/components/ui/code-block";
import { Loading } from "../ui/loading";

/** The comment's patch as plain text while its highlighted diff is on its way. */
export function ReviewCommentDiffLoading({ patch }: { patch: string }) {
  return (
    <Loading label="The diff">
      <CodeBlock wrap={false}>{patch}</CodeBlock>
    </Loading>
  );
}
