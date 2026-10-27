import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownOption(HqAttentionValue);
/**
 * Whether `next` replaces `before`; `live` when it came on the link HQ hears of its Mate. Inside one
 * environment a Mate's runs order by their epoch, whichever link brings them: a later run always
 * wins, an earlier one never; inside one run a newer revision wins from the link HQ hears, and
 * another incarnation in the same epoch names no later run, so it never wins. Between two
 * environments there is no order: only a live value replaces.
 */
const replaces = (before: HqAttentionValue, next: HqAttentionValue, live: boolean): boolean => {
  if (before.source.environmentId !== next.source.environmentId) return live;
  if (before.source.epoch !== next.source.epoch) return next.source.epoch > before.source.epoch;
  return (
    live &&
    before.source.incarnation === next.source.incarnation &&
    next.source.revision > before.source.revision
  );
};

/** The attention to hold after `input`: `before` where it is malformed or does not replace it. */
export const acceptAttention = (
  before: HqAttentionValue | null,
  input: unknown,
  live: boolean,
): HqAttentionValue | null => {
  const read = decode(input);
  if (Option.isNone(read)) return before;
  if (before === null) return live ? read.value : null;
  return replaces(before, read.value, live) ? read.value : before;
};
