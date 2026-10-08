import type { ModelSelection } from "@t3tools/contracts";
import { changedOptionIds } from "@t3tools/shared/modelOptions";

/**
 * What a session must do to run with a requested model selection:
 * - `none`: it already runs with it;
 * - `in-session`: the adapter applies it to the live session on the next send;
 * - `new-session`: only a new session can run it.
 */
export type ModelSelectionChange = "none" | "in-session" | "new-session";

/** Option ids whose values differ; order and absent vs empty options don't count. */
export function changedModelOptionIds(
  previous: ModelSelection,
  requested: ModelSelection,
): ReadonlyArray<string> {
  return changedOptionIds(previous.options, requested.options);
}

export function sameModelSelection(a: ModelSelection, b: ModelSelection): boolean {
  return (
    a.instanceId === b.instanceId && a.model === b.model && changedModelOptionIds(a, b).length === 0
  );
}

export function classifyModelSelectionChange(input: {
  /** What the live session runs with; undefined when it is not known. */
  readonly previous: ModelSelection | undefined;
  readonly requested: ModelSelection;
  /** Options the adapter applies to a live session (its `inSessionModelOptions`). */
  readonly inSessionOptions: ReadonlyArray<string>;
  /** The adapter switches models inside a live session. */
  readonly modelSwitchInSession: boolean;
}): ModelSelectionChange {
  const { previous, requested } = input;
  if (previous === undefined || previous.instanceId !== requested.instanceId) return "new-session";
  if (sameModelSelection(previous, requested)) return "none";
  if (previous.model !== requested.model && !input.modelSwitchInSession) return "new-session";
  const inSession = new Set(input.inSessionOptions);
  return changedModelOptionIds(previous, requested).every((id) => inSession.has(id))
    ? "in-session"
    : "new-session";
}

/**
 * The selection a message is sent with once it has waited: the one it was sent
 * with, unless the thread's selection changed while it waited, which is then
 * the person's latest word.
 */
export function selectionAtSend(input: {
  readonly requested: ModelSelection | undefined;
  readonly threadWhenSent: ModelSelection;
  readonly threadNow: ModelSelection;
}): ModelSelection | undefined {
  const { requested, threadWhenSent, threadNow } = input;
  if (requested === undefined || sameModelSelection(threadWhenSent, threadNow)) return requested;
  return threadNow.instanceId === requested.instanceId ? threadNow : requested;
}
