/** HQ owns completed Mate provider consumption; report demand never opens Mate sockets. */
import {
  UsageReport,
  UsageReportQuery,
  type UsageReportQuery as ReportQuery,
} from "@t3tools/contracts";
import { usageCanonical } from "@t3tools/shared/agentUsage";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { scopeOf, type FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly agentUsage: UsageReport;
  }
}
const decode = Schema.decodeUnknownOption(UsageReport);
const query = Schema.decodeUnknownSync(Schema.fromJsonString(UsageReportQuery));
export const agentUsageOwner = (value: ReportQuery): string => usageCanonical(value);
export const agentUsageId = (orgId: string, owner: string): string =>
  JSON.stringify([orgId, owner]);
export const agentUsageFamily: FamilySpec<"agentUsage"> = {
  family: "agentUsage",
  authority: "hq",
  scope: { source: "hq", suffix: "agent-usage", leaving: "removed", demand: "detail" },
  hq: {
    scope: "agentUsage",
    idOf: (key, owner) =>
      key === "report" && owner.ownerId !== null ? agentUsageId(owner.orgId, owner.ownerId) : null,
    keyOf: () => "report",
    decode: (raw, _key, owner) => {
      const report = Option.getOrNull(decode(raw));
      return report !== null && agentUsageOwner(report.query) === owner?.ownerId ? report : null;
    },
    wireScope: (owner) => ({ kind: "agentUsage", query: query(owner) }),
  },
};
export const agentUsageScope = (orgId: string, owner: string) =>
  scopeOf(agentUsageFamily, orgId, owner);
