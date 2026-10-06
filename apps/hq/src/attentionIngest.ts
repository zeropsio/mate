import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownOption(HqAttentionValue);
/**
 * Whether `next` replaces `before`. Inside one environment a Mate's runs order by their epoch, and
 * a run's values by their revision: a later run always wins, an earlier one never, whichever link
 * brought it; another incarnation in the same epoch names no later run, so it never wins. Between
 * two environments there is no order, and link fencing alone decides.
 */
const replaces = (before: HqAttentionValue, next: HqAttentionValue): boolean => {
  if (before.source.environmentId !== next.source.environmentId) return true;
  if (before.source.epoch !== next.source.epoch) return next.source.epoch > before.source.epoch;
  return (
    before.source.incarnation === next.source.incarnation &&
    next.source.revision > before.source.revision
  );
};

/** The attention to hold after `input`: `before` where it is malformed or not newer. */
export const acceptAttention = (
  before: HqAttentionValue | null,
  input: unknown,
): HqAttentionValue | null => {
  const read = decode(input);
  if (Option.isNone(read)) return before;
  return before === null || replaces(before, read.value) ? read.value : before;
};
