/** HQ's setup as its operation receipts say it; the project-env journal remains its recovery authority. */
import { HQ_BIRTH_START, type HqBirthOutcome, type HqBirthRecord } from "../../zerops/hq/birth.ts";
import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface HqBirthProgress {
  readonly attempt: number;
  readonly record: HqBirthRecord;
  readonly running: boolean;
  readonly failed: Extract<HqBirthOutcome, { readonly ok: false }> | null;
}

export const hqBirthRequestId = (orgId: string, attempt: number): string =>
  `hq-birth:${orgId}#${attempt}`;

export const hqBirthProgress: Projection<string, HqBirthProgress | null> = {
  name: "hqBirthProgress",
  keyOf: (orgId) => orgId,
  equals: sameValue,
  derive: (read, orgId) => {
    let latest: HqBirthProgress | null = null;
    let record: HqBirthRecord = HQ_BIRTH_START;
    for (let attempt = 1; ; attempt += 1) {
      const operation = read.operation(hqBirthRequestId(orgId, attempt));
      if (operation === undefined) return latest;
      const result = operationResult(operation, "hq-birth");
      record = result?.record ?? record;
      latest = {
        attempt,
        record,
        running: result?.failed == null && operation.receipt?.outcome.kind !== "succeeded",
        failed: result?.failed ?? null,
      };
    }
  },
};
