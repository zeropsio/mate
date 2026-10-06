import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownOption(HqAttentionValue);
/** Link fencing determines the source incarnation. Within it, only a newer revision wins. */
export const acceptAttention = (
  before: HqAttentionValue | null,
  input: unknown,
): HqAttentionValue | null => {
  const read = decode(input);
  if (Option.isNone(read)) return before;
  const next = read.value;
  if (
    before?.source.incarnation === next.source.incarnation &&
    before.source.environmentId === next.source.environmentId &&
    before.source.revision >= next.source.revision
  )
    return before;
  return next;
};
