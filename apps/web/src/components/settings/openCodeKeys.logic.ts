import {
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
} from "@t3tools/contracts";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";

const OPENCODE = ProviderDriverKind.make("opencode");

const KEY_VARIABLES = new Set(OPENCODE_KEY_PROVIDERS.map((provider) => provider.variable));

const isProviderKey = (
  instance: ProviderInstanceConfig,
  variable: ProviderInstanceEnvironmentVariable,
): boolean => instance.driver === OPENCODE && KEY_VARIABLES.has(variable.name);

/**
 * The variables the instance's own editor lists: an OpenCode instance's provider keys are shown
 * once, on their key line, never again as a row of the editor.
 */
export function environmentShownBesideKeys(
  instance: ProviderInstanceConfig,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  return (instance.environment ?? []).filter((variable) => !isProviderKey(instance, variable));
}

/** The instance's variables after its editor changed the ones it lists: the keys stay. */
export function environmentKeptWithKeys(
  instance: ProviderInstanceConfig,
  edited: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const keys = (instance.environment ?? []).filter((variable) => isProviderKey(instance, variable));
  return [...keys, ...edited];
}
