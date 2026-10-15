import { changeKindTag, type GitOverviewChange } from "@t3tools/client-runtime/zerops";
import { Button } from "../ui/button";
import { STATUS_BADGE_TONE } from "./primitives";
import { Badge } from "~/components/ui/badge";

/** The same projected change and review action in the overview and repository detail. */
export function ZeropsGitChangeRow({
  change: { pull, line, status },
  project,
  repo,
  onOpen,
}: {
  readonly change: GitOverviewChange;
  readonly project: string;
  readonly repo: string;
  readonly onOpen?: (() => void) | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" data-zerops-surface="pull-request-title">
          {pull.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{line}</span>
          <span>{changeKindTag(pull)}</span>
          {status === undefined ? null : (
            <Badge dot tone={STATUS_BADGE_TONE[status.tone]}>
              {status.word}
            </Badge>
          )}
        </div>
      </div>
      <Button
        variant="secondary"
        size="md"
        disabled={onOpen === undefined}
        aria-label={`Review ${project} / ${repo} #${pull.number}`}
        onClick={onOpen}
      >
        Review
      </Button>
    </div>
  );
}
