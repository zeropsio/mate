/**
 * Quick actions: one click puts a sentence in the composer.
 *
 * They are prompts, never calls. Every change to a Zerops project goes through
 * the agent's MCP tools, so these prefill and stop — the same seam the file
 * browser's "add to chat" uses (`FileBrowserPanel`). Which actions make sense
 * is decided in `@t3tools/client-runtime/zerops/quickActions`.
 */
import { useComposerHandleContext } from "../../composerHandleContext";
import type { ZeropsQuickAction } from "@t3tools/client-runtime/zerops/quickActions";
import { Pill } from "./primitives";

export function ZeropsQuickActions({
  actions,
  onInsert,
}: {
  readonly actions: ReadonlyArray<ZeropsQuickAction>;
  /** Overridden in tests; defaults to the mounted composer. */
  readonly onInsert?: (prompt: string) => void;
}) {
  const composerRef = useComposerHandleContext();

  if (actions.length === 0) {
    return null;
  }

  const insert = (prompt: string) => {
    if (onInsert !== undefined) {
      onInsert(prompt);
      return;
    }
    // insertTextAtEnd refuses while a question is pending or the thread is
    // connecting, and says so by returning false. That refusal is correct —
    // the answer belongs in the question card, not appended to a draft — so
    // there is nothing to do about it here.
    composerRef?.current?.insertTextAtEnd(prompt, { ensureLeadingBoundary: true });
  };

  return (
    <div className="flex flex-wrap gap-1.5" data-zerops-quick-actions>
      {actions.map((action) => (
        <Pill
          className="min-h-8 px-3 py-1.5 text-xs"
          key={action.id}
          label={action.label}
          onClick={() => {
            insert(action.prompt);
          }}
          tone="secondary"
        />
      ))}
    </div>
  );
}
