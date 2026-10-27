/**
 * The model providers a Mate's OpenCode signs in to with one API key, and the
 * settings writes that give the default OpenCode instance such a key.
 *
 * OpenCode reads its providers from models.dev; one whose only credential is
 * one environment variable is connected the moment that variable is set in
 * OpenCode's environment. Mate keeps the key as a secret variable of the
 * OpenCode instance (`providerInstances[].environment`, sensitive), so adding
 * such a provider is one row here: its models.dev id, the name OpenCode
 * reports for it, and its variable.
 *
 * @module openCodeKeyProviders
 */
import {
  DEFAULT_SERVER_SETTINGS,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";

/**
 * A model an organization may pick for its automated Mates (Settings › Automation), as models.dev
 * lists it under the provider. Its prices are models.dev's, which OpenCode charges a turn by and
 * HQ's usage prices read: a model is offered only where every kind of token it bills is priced, so
 * a task on it never reads $0 and always meets its cost limit.
 */
export interface AutomatedModel {
  /** models.dev's id under the provider (the slug without the provider's segment). */
  readonly id: string;
  /** Its name as people see it. */
  readonly name: string;
  /** US dollars per million tokens. */
  readonly usdPerMillion: {
    readonly input: number;
    readonly cachedInput: number;
    readonly output: number;
  };
  /**
   * Whether it reads images, as models.dev's `modalities.input` lists them: OpenCode swaps an image
   * sent to a model without them for an error.
   */
  readonly readsImages: boolean;
  /** Why pick it, in one line. */
  readonly why: string;
}

export interface OpenCodeKeyProvider {
  /** models.dev's provider id: the first segment of the model slugs OpenCode lists. */
  readonly id: string;
  /** The provider's name as OpenCode reports it, and as people see it. */
  readonly name: string;
  /** The environment variable OpenCode reads the key from. */
  readonly variable: string;
  /** What its key runs, in people's words: "Runs OpenCode on <models>". */
  readonly models: string;
  /** Its OpenAI-compatible API, for an app that calls it with the same key. */
  readonly baseUrl: string;
  /**
   * The model an automated Mate's agents run on with the organization's key, as models.dev lists
   * it under this provider (without the provider's segment) — its strongest for coding with tools —
   * until the organization picks another of `automatedModels`.
   */
  readonly automatedModel: string;
  /** The models an organization may pick for its automated Mates: tool-calling, fully priced. */
  readonly automatedModels: ReadonlyArray<AutomatedModel>;
}

export const OPENCODE_KEY_PROVIDERS: ReadonlyArray<OpenCodeKeyProvider> = [
  {
    id: "nebius",
    name: "Nebius Token Factory",
    variable: "NEBIUS_API_KEY",
    models: "open models — Kimi, Qwen, DeepSeek, GLM and more",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    // models.dev: "Flagship GLM model for long-horizon coding, agents, and complex project
    // delivery" — tool calls and reasoning, a 1M context with no short cap on what one answer
    // writes (Kimi K3 stops at 8k), a third of Kimi K3's price.
    automatedModel: "zai-org/GLM-5.3",
    // Kimi K2.7 Code ($0.95/$4.00) is left out: models.dev prices no cached input for it, which
    // OpenCode would then charge at $0.
    automatedModels: [
      {
        id: "zai-org/GLM-5.3",
        name: "GLM-5.3",
        usdPerMillion: { input: 1.4, cachedInput: 1.4, output: 4.4 },
        readsImages: false,
        why: "The strongest for long coding work with tools; no short cap on one answer.",
      },
      {
        id: "zai-org/GLM-5.3-Flash",
        name: "GLM-5.3 Flash",
        usdPerMillion: { input: 0.15, cachedInput: 0.15, output: 0.5 },
        readsImages: false,
        why: "GLM-5.3's light sibling: the same long answers at about a tenth of the price.",
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Flash-0731",
        name: "DeepSeek V4 Flash",
        usdPerMillion: { input: 0.14, cachedInput: 0.14, output: 0.28 },
        readsImages: false,
        why: "The cheapest here: fast, reasons and calls tools; best for small, clear tasks.",
      },
      {
        id: "Qwen/Qwen3.5-397B-A17B",
        name: "Qwen3.5 397B",
        usdPerMillion: { input: 0.6, cachedInput: 0.06, output: 3.6 },
        readsImages: false,
        why: "Strong at code, repeated context at a tenth; one answer stops at 8k tokens.",
      },
      {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        name: "DeepSeek V4.1 Flash",
        usdPerMillion: { input: 0.3, cachedInput: 0.3, output: 1.2 },
        readsImages: true,
        why: "The one here that sees images: screenshots and mockups, fast and cheap.",
      },
    ],
  },
];

/** The key-signed provider an OpenCode model slug (`provider/model`) runs on, if it is one. */
export function openCodeKeyProviderOfModel(
  model: string | null | undefined,
): OpenCodeKeyProvider | undefined {
  const providerId = model?.trim().split("/", 1)[0];
  return OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === providerId);
}

/** An OpenCode model slug (`provider/model`) of the provider's: its default for automated Mates. */
export const automatedOpenCodeModel = (
  provider: OpenCodeKeyProvider,
  model: string = provider.automatedModel,
): string => `${provider.id}/${model}`;

/**
 * The offered model an OpenCode slug names — one of the first provider's `automatedModels`, the
 * provider an automated Mate runs on; none for anything else.
 */
export function automatedModelOffer(slug: string | null | undefined): AutomatedModel | undefined {
  const provider = OPENCODE_KEY_PROVIDERS[0];
  if (provider === undefined) return undefined;
  return provider.automatedModels.find(
    (offer) => automatedOpenCodeModel(provider, offer.id) === slug?.trim(),
  );
}

/** The slug an automated Mate runs on, given the organization's pick: offered, else the default. */
export function automatedModelOf(slug: string | null | undefined): string {
  const provider = OPENCODE_KEY_PROVIDERS[0]!;
  return automatedOpenCodeModel(provider, automatedModelOffer(slug)?.id);
}

const OPENCODE = ProviderDriverKind.make("opencode");

/**
 * The default OpenCode instance, as the Agents settings draw it: a key is written to this one. One
 * the settings never wrote is made from the legacy settings, their enabled flag on the envelope.
 */
export function defaultOpenCodeInstance(
  settings: Pick<ServerSettings, "providers" | "providerInstances">,
): ProviderInstanceConfig {
  const configured = settings.providerInstances[defaultInstanceIdForDriver(OPENCODE)];
  if (configured !== undefined) return configured;
  const { enabled, ...config } = settings.providers.opencode;
  return { driver: OPENCODE, enabled, config };
}

const keyVariableOf = (
  instance: ProviderInstanceConfig | undefined,
  provider: OpenCodeKeyProvider,
): ProviderInstanceEnvironmentVariable | undefined =>
  instance?.environment?.findLast((variable) => variable.name === provider.variable);

/**
 * Whether the instance holds a key for the provider. The server sends a stored
 * key back as `valueRedacted` with no value: a client learns that it is set,
 * never what it is.
 */
export function openCodeKeyIsSet(
  instance: ProviderInstanceConfig | undefined,
  provider: OpenCodeKeyProvider,
): boolean {
  const variable = keyVariableOf(instance, provider);
  return variable !== undefined && (variable.valueRedacted === true || variable.value.length > 0);
}

/** The key the instance holds for the provider, where it holds the value (the server's own read). */
export function openCodeKeyValue(
  instance: ProviderInstanceConfig | undefined,
  provider: OpenCodeKeyProvider,
): string | undefined {
  const value = keyVariableOf(instance, provider)?.value;
  return value === undefined || value.length === 0 ? undefined : value;
}

function withEnvironment(
  instance: ProviderInstanceConfig,
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): ProviderInstanceConfig {
  const { environment: _previous, ...rest } = instance;
  return environment.length === 0 ? rest : { ...rest, environment };
}

/**
 * The instance with the key stored for the provider — a sensitive variable,
 * which the server keeps in its secret store — and OpenCode on: a key is given
 * to run on that provider's models.
 */
export function withOpenCodeKey(
  instance: ProviderInstanceConfig,
  provider: OpenCodeKeyProvider,
  key: string,
): ProviderInstanceConfig {
  const others = (instance.environment ?? []).filter(
    (variable) => variable.name !== provider.variable,
  );
  return withEnvironment({ ...instance, enabled: true }, [
    ...others,
    { name: provider.variable, value: key.trim(), sensitive: true },
  ]);
}

/** The instance without the provider's key; everything else stays as it was. */
export function withoutOpenCodeKey(
  instance: ProviderInstanceConfig,
  provider: OpenCodeKeyProvider,
): ProviderInstanceConfig {
  return withEnvironment(
    instance,
    (instance.environment ?? []).filter((variable) => variable.name !== provider.variable),
  );
}

/** The settings write that makes `next` the default OpenCode instance, as the Agents settings write it. */
export function openCodeInstancePatch(
  settings: Pick<ServerSettings, "providers" | "providerInstances">,
  next: ProviderInstanceConfig,
): ServerSettingsPatch {
  // Only server keys: the instance map and, for the default slot, its legacy mirror at its default.
  return {
    providers: { ...settings.providers, opencode: DEFAULT_SERVER_SETTINGS.providers.opencode },
    providerInstances: {
      ...settings.providerInstances,
      [defaultInstanceIdForDriver(OPENCODE)]: next,
    },
  } as ServerSettingsPatch;
}
