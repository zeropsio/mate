/**
 * The model providers a Mate's OpenCode signs in to with one API key.
 *
 * OpenCode reads its providers from models.dev; one whose only credential is
 * one environment variable is connected the moment that variable is set in
 * OpenCode's environment. Mate keeps the key as a secret variable of the
 * OpenCode instance (`providerInstances[].environment`, sensitive), so adding
 * such a provider is one row here: its models.dev id, the name OpenCode
 * reports for it, and its variable.
 */
export interface OpenCodeKeyProvider {
  /** models.dev's provider id: the first segment of the model slugs OpenCode lists. */
  readonly id: string;
  /** The provider's name as OpenCode reports it, and as people see it. */
  readonly name: string;
  /** The environment variable OpenCode reads the key from. */
  readonly variable: string;
  /** What its key runs, in people's words: "Runs OpenCode on <models>". */
  readonly models: string;
}

export const OPENCODE_KEY_PROVIDERS: ReadonlyArray<OpenCodeKeyProvider> = [
  {
    id: "nebius",
    name: "Nebius Token Factory",
    variable: "NEBIUS_API_KEY",
    models: "open models — Kimi, Qwen, DeepSeek, GLM and more",
  },
];

/** The key-signed provider an OpenCode model slug (`provider/model`) runs on, if it is one. */
export function openCodeKeyProviderOfModel(
  model: string | null | undefined,
): OpenCodeKeyProvider | undefined {
  const providerId = model?.trim().split("/", 1)[0];
  return OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === providerId);
}
