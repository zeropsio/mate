import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HqBirthDeletion } from "../../zerops/hq/client.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqBirthDeletion: HqBirthDeletion;
  }
}

const PREFIX = "birth-deletion:";
const decode = Schema.decodeUnknownOption(HqBirthDeletion);

/** The maker's deletions and their outcomes, retained by HQ until acknowledged. */
export const hqBirthDeletionFamily: FamilySpec<"hqBirthDeletion"> = {
  family: "hqBirthDeletion",
  authority: "hq",
  scope: { source: "hq", suffix: "birth-deletions", leaving: "removed", demand: "navigation" },
  hq: {
    scope: "navigation",
    idOf: (key) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null),
    keyOf: (id) => `${PREFIX}${id}`,
    decode: (raw, key) => {
      const deletion = Option.getOrNull(decode(raw));
      return deletion?.id === key.slice(PREFIX.length) ? deletion : null;
    },
  },
};

export const hqBirthDeletionsScope = (orgId: string) => scopeOf(hqBirthDeletionFamily, orgId);
