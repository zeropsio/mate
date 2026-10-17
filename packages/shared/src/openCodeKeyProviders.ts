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
}

export const OPENCODE_KEY_PROVIDERS: ReadonlyArray<OpenCodeKeyProvider> = [
  {
    id: "nebius",
    name: "Nebius Token Factory",
    variable: "NEBIUS_API_KEY",
    models: "open models — Kimi, Qwen, DeepSeek, GLM and more",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
  },
];

/** The key-signed provider an OpenCode model slug (`provider/model`) runs on, if it is one. */
export function openCodeKeyProviderOfModel(
  model: string | null | undefined,
): OpenCodeKeyProvider | undefined {
  const providerId = model?.trim().split("/", 1)[0];
  return OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === providerId);
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
