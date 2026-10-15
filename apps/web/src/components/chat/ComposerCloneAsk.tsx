/**
 * The project's repository while it clones, at the composer's top in the asks' look (`ComposerAsk`):
 * cloning stops nothing but Send — the person writes, attaches and picks a model meanwhile — so it
 * never takes the composer's place. Running, it offers Cancel; failed or cancelled, Retry and
 * Remove project, a failure's own words whole.
 */
import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import { DownloadIcon } from "lucide-react";

import { Button } from "../ui/button";
import { ComposerAsk, ComposerAskButton } from "./ComposerAsk";

export interface ComposerCloneActions {
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly remove: () => void;
}

/** Why Send waits while the project's repository is not cloned; null once it is, or with none. */
export function cloneSendBlockReason(clone: ProjectCloneSnapshot | null): string | null {
  if (clone === null || clone.phase === "done") return null;
  return clone.phase === "running"
    ? "Sends once the repository is cloned"
    : "The repository isn't cloned: retry the clone to send";
}

export function ComposerCloneAsk({
  clone,
  actions,
}: {
  readonly clone: ProjectCloneSnapshot | null;
  readonly actions: ComposerCloneActions;
}) {
  if (clone === null || clone.phase === "done") return null;
  const name = projectCloneDisplayName(clone);
  const face = (
    <DownloadIcon aria-hidden="true" className="size-4 justify-self-center text-muted-foreground" />
  );
  if (clone.phase === "running") {
    return (
      <ComposerAsk
        actions={<ComposerAskButton onClick={actions.cancel}>Cancel</ComposerAskButton>}
        detail={
          <p className="truncate">
            {name} · {projectCloneProgressSummary(clone)}
          </p>
        }
        face={face}
        kind="clone"
        label="Cloning the repository"
        title="Cloning the repository…"
      />
    );
  }
  const cancelled = clone.phase === "cancelled";
  const why = cancelled ? "Retry to bring in the repository." : clone.error;
  return (
    <ComposerAsk
      actions={
        <>
          <Button onClick={actions.remove} size="md" variant="ghost">
            Remove project
          </Button>
          <ComposerAskButton onClick={actions.retry}>Retry</ComposerAskButton>
        </>
      }
      detail={
        why ? (
          // A failure's words are never cut: whole, wrapped, four lines and the rest scrolled.
          <p className="max-h-18 overflow-y-auto whitespace-pre-wrap wrap-break-word">{why}</p>
        ) : undefined
      }
      face={face}
      kind="clone"
      label={cancelled ? "Cloning cancelled" : "Cloning failed"}
      title={cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`}
    />
  );
}
