/** Account-local review dismissal preferences. No source text, face or verdict is stored. */
import * as Schema from "effect/Schema";
import { accountLocalStorage } from "./accountLifetime";

const KEY = "mate:composer-review-dismissals";
const Ids = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const decodeIds = Schema.decodeUnknownSync(Ids);
const encodeIds = Schema.encodeSync(Ids);
const read = () => {
  try {
    return decodeIds(accountLocalStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
export function dismissedComposerReview(threadKey: string): string | undefined {
  return read()[threadKey];
}
export function dismissComposerReview(threadKey: string, changeId: string): void {
  try {
    accountLocalStorage.setItem(KEY, encodeIds({ ...read(), [threadKey]: changeId }));
  } catch {
    /* Blocked preferences cannot restore a remote answer. */
  }
}
