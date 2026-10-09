import { changeKindTag, type GitOverviewChange } from "@t3tools/client-runtime/zerops";
import { Button } from "../ui/button";
import { StatusDot } from "./primitives";

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
            <StatusDot label={status.word} sentence tone={status.tone} />
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={onOpen === undefined}
        aria-label={`Review ${project} / ${repo} #${pull.number}`}
        onClick={onOpen}
      >
        Review
      </Button>
    </div>
  );
}
