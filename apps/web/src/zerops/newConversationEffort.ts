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
import { withPreferredEffort } from "@t3tools/shared/zeropsEffort";

/**
 * A draft, or a thread that never ran a turn. A crewmate's thread is never
 * one: crewmates keep their own rule (unset = the login's default).
 */
export function isNewConversation(
  routeKind: "server" | "draft",
  thread: Pick<OrchestrationThread, "latestTurn" | "crew"> | undefined,
): boolean {
  if (routeKind === "draft") return true;
  return thread !== undefined && thread.latestTurn === null && thread.crew === undefined;
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
