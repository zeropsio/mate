/**
 * What the composer's one quiet control says (C4): the model, then its effort,
 * then only what is off its default — "Sonnet 5 · High", "Sonnet 5 · Max · 1M".
 * Fast mode is a bolt beside the words, never a word. Everything else the
 * model offers is in the control's menu, where it can always be reached.
 */
import {
  DEFAULT_RUNTIME_MODE,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

export interface ComposerModelControlLabel {
  /** The model, without the agent's own name — its mark beside it says that. */
  readonly model: string;
  /** Its effort, then each other choice that is not the default. */
  readonly traits: ReadonlyArray<string>;
  /** Fast mode is on: drawn as a bolt. */
  readonly fast: boolean;
}

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

/** "Claude Sonnet 5" beside Claude's mark reads "Sonnet 5"; a name that is only the agent's stays. */
function withoutAgentName(modelName: string, provider: ProviderDriverKind): string {
  const agent = PROVIDER_DISPLAY_NAMES[provider];
  if (agent === undefined) return modelName;
  const prefix = `${agent} `;
  if (!modelName.toLowerCase().startsWith(prefix.toLowerCase())) return modelName;
  const rest = modelName.slice(prefix.length).trim();
  return rest.length > 0 ? rest : modelName;
}

/** Codex spells fast mode as a service tier named "Fast"; its standard tier is the default. */
function fastTierOf(descriptor: SelectDescriptor): string | undefined {
  if (descriptor.id !== "serviceTier") return undefined;
  return descriptor.options.find((option) => option.label === "Fast")?.id;
}

function isDefaultChoice(descriptor: SelectDescriptor): boolean {
  const current = getProviderOptionCurrentValue(descriptor);
  const fallback = descriptor.options.find((option) => option.isDefault)?.id;
  return fallback === undefined || current === fallback;
}

export function composerModelControlLabel(input: {
  readonly provider: ProviderDriverKind;
  readonly modelName: string;
  /** The model's options as chosen now (`getProviderOptionDescriptors`). */
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  /** "Ultrathink:" written into the prompt sets the effort instead of an option. */
  readonly ultrathinkPromptControlled: boolean;
}): ComposerModelControlLabel {
  const traits: Array<string> = [];
  let fast = false;
  // The first choice a model offers is its effort, and it is always said.
  let effortSeen = false;
  for (const descriptor of input.descriptors) {
    if (descriptor.type === "boolean") {
      if (descriptor.id === "fastMode") fast = descriptor.currentValue === true;
      continue;
    }
    const fastTier = fastTierOf(descriptor);
    if (fastTier !== undefined && getProviderOptionCurrentValue(descriptor) === fastTier) {
      fast = true;
      continue;
    }
    if (!effortSeen && fastTier === undefined) {
      effortSeen = true;
      const effort = input.ultrathinkPromptControlled
        ? "Ultrathink"
        : getProviderOptionCurrentLabel(descriptor);
      if (effort !== undefined) traits.push(effort);
      continue;
    }
    if (isDefaultChoice(descriptor)) continue;
    const label = getProviderOptionCurrentLabel(descriptor);
    if (label !== undefined) traits.push(label);
  }
  return { model: withoutAgentName(input.modelName, input.provider), traits, fast };
}

/** The control's words as one line: its accessible name, and what a test reads. */
export function composerModelControlText(label: ComposerModelControlLabel): string {
  return [label.model, ...label.traits].join(" · ");
}

/**
 * Whether the access control stands in the toolbar on its own: while it is
 * not the person's usual setting, and whenever the one control's menu — where
 * the usual one is kept — cannot be opened, with the provider's setup in the
 * control's place or the catalog still being read. Access is reachable in
 * every state.
 */
export function showsAccessControl(
  runtimeMode: RuntimeMode,
  input: { readonly modelMenuOpens: boolean },
): boolean {
  return runtimeMode !== DEFAULT_RUNTIME_MODE || !input.modelMenuOpens;
}
