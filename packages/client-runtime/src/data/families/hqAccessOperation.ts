import { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqAccessOperation: HqAccessOperation;
  }
}
const decode = Schema.decodeUnknownOption(HqAccessOperation);
/** The access changes this person started, each as HQ's navigation shows it under `access:<id>`. */
export const hqAccessOperationFamily: FamilySpec<"hqAccessOperation"> = {
  family: "hqAccessOperation",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-access", leaving: "removed", demand: "navigation" },
  hq: {
    scope: "navigation",
    idOf: (key) => (key.startsWith("access:") ? key.slice(7) : null),
    keyOf: (id) => `access:${id}`,
    decode: (raw, key) => {
      const operation = Option.getOrNull(decode(raw));
      return operation?.id === key.slice(7) ? operation : null;
    },
  },
};
