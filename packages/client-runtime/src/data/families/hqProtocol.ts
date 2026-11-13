/** The Core's declared protocols, each read on its own: one this client does not know reads as absent. */
import { HqCoreProtocol } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import { navigationRecord } from "./navigationRecord.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

const Core = navigationRecord(HqCoreProtocol.fields);
export const decodeHqProtocol = Schema.decodeUnknownSync(Core);

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqProtocol: typeof Core.Type;
  }
}

export const hqProtocolFamily: FamilySpec<"hqProtocol"> = {
  family: "hqProtocol",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-protocol", leaving: "removed", demand: "navigation" },
};
export const hqProtocolScope = (orgId: string): ScopeKey => scopeOf(hqProtocolFamily, orgId);
