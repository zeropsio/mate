/** The Core's declared navigation protocol, including an older Core that declares none. */
import { HqCoreProtocol } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import { navigationRecord } from "./navigationRecord.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

const Core = navigationRecord(HqCoreProtocol.fields);
export const decodeHqProtocol = Schema.decodeUnknownOption(Core);

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
