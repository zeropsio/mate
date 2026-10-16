import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ServerSettingsPatch,
  type UnifiedSettings,
} from "@t3tools/contracts";
import type { OpenCodeKeyProvider } from "@t3tools/shared/openCodeKeyProviders";

import {
  buildProviderInstanceUpdatePatch,
  defaultProviderInstanceConfig,
} from "./SettingsPanels.logic";

const OPENCODE = ProviderDriverKind.make("opencode");

/** The default OpenCode instance, as the Agents settings draw it: a key is written to this one. */
export function defaultOpenCodeInstance(
  settings: Pick<UnifiedSettings, "providers" | "providerInstances">,
): ProviderInstanceConfig | undefined {
  return (
    settings.providerInstances[defaultInstanceIdForDriver(OPENCODE)] ??
    defaultProviderInstanceConfig(settings, OPENCODE)
  );
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
  settings: Pick<UnifiedSettings, "providers" | "providerInstances">,
  next: ProviderInstanceConfig,
): ServerSettingsPatch {
  // Only server keys: the instance map and, for the default slot, its legacy mirror.
  return buildProviderInstanceUpdatePatch({
    settings,
    instanceId: defaultInstanceIdForDriver(OPENCODE),
    instance: next,
    driver: OPENCODE,
    isDefault: true,
  }) as ServerSettingsPatch;
}
