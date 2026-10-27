/**
 * The composer's side of D10: a new conversation shows and sends Extra High
 * (`@t3tools/shared/zeropsEffort`), a conversation that has run keeps what it
 * has, and a person's own pick always wins.
 */
import type {
  ModelCapabilities,
  OrchestrationThread,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { isUnstartedThread, withPreferredEffort } from "@t3tools/shared/zeropsEffort";

/** A draft, or a thread that never ran a turn (and is no crewmate's). */
export function isNewConversation(
  routeKind: "server" | "draft",
  thread: Pick<OrchestrationThread, "latestTurn" | "crew"> | undefined,
): boolean {
  return routeKind === "draft" || isUnstartedThread(thread);
}

/** The model options the composer shows and sends. */
export function composerModelOptionsFor(input: {
  readonly isNew: boolean;
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly options: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<ProviderOptionSelection> | undefined {
  const options = input.options ?? undefined;
  return input.isNew ? withPreferredEffort(input.capabilities, options) : options;
}
