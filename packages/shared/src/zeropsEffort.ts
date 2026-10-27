/**
 * The effort a new conversation starts on (D10, the owner, 2026-10-05): Extra
 * High wherever the model offers it. The drivers keep their own `isDefault`
 * (Claude's is Medium); this is Mate's preference, laid over a selection that
 * names no effort yet — a person's own pick, or a conversation that already
 * has one, is never touched. Crewmates keep their own rule (unset = the
 * login's default) and never pass through here.
 */
import type {
  ModelCapabilities,
  ModelSelection,
  OrchestrationThreadShell,
  ProviderOptionSelection,
  ServerProvider,
} from "@t3tools/contracts";

import { resolveSelectableModel } from "./model.ts";

/**
 * The model option each agent's effort is: Claude's `effort`, Codex's and
 * Grok's `reasoningEffort`, Cursor's `reasoning`, OpenCode's `variant`.
 */
export const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "effort",
  "reasoningEffort",
  "reasoning",
  "variant",
]);

/**
 * The effort ids a model may offer below `max`, lowest first. The ladder ranks,
 * not the order a driver reports: Grok reports its levels top first, OpenCode's
 * come from an object's keys, and Claude lists prompt-injected values after
 * `max`. An id off the ladder cannot be judged higher, so it is never chosen.
 */
const EFFORT_LADDER: ReadonlyArray<string> = ["none", "minimal", "low", "medium", "high", "xhigh"];

/** `xhigh` when offered, else the highest ladder step below `max`, else none. */
export function preferredEffort(options: ReadonlyArray<{ readonly id: string }>): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const option of options) {
    const rank = EFFORT_LADDER.indexOf(option.id);
    if (rank > bestRank) {
      best = option.id;
      bestRank = rank;
    }
  }
  return best;
}

/** The options with the preferred effort added, when they name no effort yet. */
export function withPreferredEffort(
  capabilities: ModelCapabilities | null | undefined,
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const current = options ?? undefined;
  const descriptor = capabilities?.optionDescriptors?.find(
    (candidate) => candidate.type === "select" && EFFORT_OPTION_IDS.has(candidate.id),
  );
  if (descriptor?.type !== "select") return current;
  if (current?.some((option) => option.id === descriptor.id)) return current;
  const effort = preferredEffort(descriptor.options);
  if (effort === null) return current;
  return [...(current ?? []), { id: descriptor.id, value: effort }];
}

/** A new conversation's selection with the preferred effort of its model. */
export function selectionWithPreferredEffort(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ModelSelection {
  // The model as the composer reads it: by slug, name or alias (`resolveSelectableModel`).
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const slug = provider
    ? resolveSelectableModel(provider.driver, selection.model, provider.models)
    : null;
  const capabilities = provider?.models.find((model) => model.slug === slug)?.capabilities;
  const options = withPreferredEffort(capabilities, selection.options);
  return options === selection.options || options === undefined
    ? selection
    : { ...selection, options };
}

/**
 * A thread that never ran a turn: its conversation is still new. A crewmate's
 * thread never is one — crewmates keep their own rule — and a thread not yet
 * read is not judged.
 */
export function isUnstartedThread(
  thread: Pick<OrchestrationThreadShell, "latestTurn" | "crew"> | null | undefined,
): boolean {
  return thread != null && thread.latestTurn === null && thread.crew === undefined;
}

/**
 * The last-used selection a new draft inherits, without its effort: touching
 * any trait remembers every option's value, the default effort included, so a
 * remembered effort is nobody's pick for the next conversation. The model and
 * the other traits carry over; the preference sets the effort.
 */
export function selectionWithoutEffort<Selection extends ModelSelection>(
  selection: Selection,
): Selection {
  if (!selection.options?.some((option) => EFFORT_OPTION_IDS.has(option.id))) return selection;
  const { options, ...rest } = selection;
  const kept = options.filter((option) => !EFFORT_OPTION_IDS.has(option.id));
  return (kept.length > 0 ? { ...rest, options: kept } : rest) as Selection;
}
