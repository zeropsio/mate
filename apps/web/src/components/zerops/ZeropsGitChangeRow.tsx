import { changeKindTag, type GitOverviewChange } from "@t3tools/client-runtime/zerops";
import { Button } from "../ui/button";
import { MateFace, STATUS_BADGE_TONE } from "./primitives";
import { Dot } from "~/components/ui/dot";
import { Row } from "~/components/ui/row";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useMateLook } from "~/zerops/useMateLook";

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
  const look = useMateLook(pull.mateProjectId);
  return (
    <Row
      lead={<MateFace size={32} state="idle" {...look} />}
      title={<span data-zerops-surface="pull-request-title">{pull.title}</span>}
      line={
        <span className="flex items-center gap-1.5">
          <span>{line}</span>
          <span>· {changeKindTag(pull)}</span>
          {status === undefined ? null : (
            <>
              <Dot tone={STATUS_BADGE_TONE[status.tone]} />
              {status.word}
            </>
          )}
        </span>
      }
      meta={pull.updatedAt === undefined ? undefined : formatRelativeTimeLabel(pull.updatedAt)}
      control={
        <Button
          variant="secondary"
          size="xs"
          disabled={onOpen === undefined}
          aria-label={`Review ${project} / ${repo} #${pull.number}`}
          onClick={onOpen}
        >
          Review
        </Button>
      }
    />
  );
}
