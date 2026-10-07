import { HqStreamMessage } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ScenarioExtension } from "../../harness/scenario.ts";

const readMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamMessage));
const readRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** A Core before navigation release offers and protocol declarations were published. */
export function olderNavigation(encoded: string): string {
  const message = Option.getOrUndefined(readMessage(encoded));
  if (message === undefined) return encoded;
  if (message.type === "scope-ready")
    return JSON.stringify(
      Object.fromEntries(Object.entries(message).filter(([key]) => key !== "core")),
    );
  if (
    (message.type !== "scope-reset" && message.type !== "scope-values") ||
    message.scope.kind !== "navigation"
  )
    return encoded;
  return JSON.stringify({
    ...message,
    values: message.values.map((entry) => {
      const value = Option.getOrUndefined(readRecord(entry.value));
      return !entry.key.startsWith("app:") || value === undefined
        ? entry
        : {
            ...entry,
            value: Object.fromEntries(
              Object.entries(value).filter(([key]) => key !== "releaseOffer"),
            ),
          };
    }),
  });
}

export const installOlderNavigation: ScenarioExtension = (drivers) => {
  drivers.hq.mapFrames(olderNavigation);
};
