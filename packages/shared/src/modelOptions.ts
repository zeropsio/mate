/**
 * The model option diff both engines decide by: which options a change touches, so each decides
 * alike whether a live session can take it or only a new one can.
 *
 * @module modelOptions
 */
import type { ProviderOptionSelection } from "@t3tools/contracts";

type ModelOptions = ReadonlyArray<ProviderOptionSelection> | undefined;

const optionValues = (options: ModelOptions) =>
  new Map((options ?? []).map((option) => [option.id, option.value]));

/** Option ids whose values differ; order and absent vs empty options don't count. */
export function changedOptionIds(
  previous: ModelOptions,
  requested: ModelOptions,
): ReadonlyArray<string> {
  const before = optionValues(previous);
  const after = optionValues(requested);
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => before.get(id) !== after.get(id)).sort();
}
