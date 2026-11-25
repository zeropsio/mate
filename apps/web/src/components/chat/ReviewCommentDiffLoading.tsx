import { Loading } from "../ui/loading";
import { Card } from "~/components/ui/card";

/** The comment's patch as plain text while its highlighted diff is on its way. */
export function ReviewCommentDiffLoading({ patch }: { patch: string }) {
  return (
    <Loading label="The diff">
      <Card variant="inset">
        <pre className="overflow-x-auto p-2 text-caption">{patch}</pre>
      </Card>
    </Loading>
  );
}
