/** Runs HQ's setup through operations, publishing its journal progress as receipts rather than a second UI store. */
import * as Effect from "effect/Effect";

import { ZeropsApiError } from "../../../zerops/api.ts";
import {
  HQ_BIRTH_START,
  runHqBirth,
  type HqBirthDeps,
  type HqBirthOutcome,
  type HqBirthRecord,
} from "../../../zerops/hq/birth.ts";
import type { OperationIntent, OperationReceipt } from "../../model.ts";
import { hqBirthProgress } from "../../projections/hqBirthProgress.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import type { OwnerUnobservable } from "../coordinator.ts";

type BirthIntent = Extract<OperationIntent, { readonly kind: "hq-birth" }>;

export function hqProvisionExecutor(input: {
  readonly store: AccountStore;
  readonly deps: HqBirthDeps;
}) {
  return (requestId: string, intent: BirthIntent) =>
    Effect.promise(async () => {
      let record: HqBirthRecord =
        hqBirthProgress.derive(readsOfState(input.store.state()), intent.orgId)?.record ??
        HQ_BIRTH_START;
      const receipt = (
        failed: Extract<HqBirthOutcome, { readonly ok: false }> | null,
        done = false,
      ): OperationReceipt => ({
        requestId,
        operationId: record.importId ?? requestId,
        executor: "zerops",
        affected: record.projectId === null ? [] : [{ family: "project", id: record.projectId }],
        handles: record.projectId === null ? [] : [record.projectId],
        acceptance: { kind: "accepted", result: { record, failed } },
        outcome: done
          ? { kind: "succeeded", evidence: "HQ is marked official." }
          : failed !== null && !failed.uncertain
            ? { kind: "failed", evidence: failed.reason }
            : { kind: "pending" },
      });
      const publish = (failed: Extract<HqBirthOutcome, { readonly ok: false }> | null = null) => {
        const next = receipt(failed);
        input.store.dispatch({ kind: "operation-receipt", receipt: next });
        return next;
      };
      let outcome: HqBirthOutcome;
      try {
        const official = await input.deps.reads.markedHq(intent.orgId);
        if (official.kind === "official") {
          record = {
            ...record,
            step: "done",
            projectId: official.projectId,
            address: official.address,
          };
          return receipt(null, true);
        }
        outcome = await runHqBirth({
          record,
          clientId: intent.orgId,
          zeropsApi: intent.zeropsApi,
          deps: input.deps,
          again: intent.again,
          moved: (patch) => {
            record = { ...record, ...patch };
            publish();
          },
        });
      } catch (cause) {
        outcome = {
          ok: false,
          step: record.step === "done" ? "ready" : record.step,
          reason: cause instanceof Error ? cause.message : "Zerops could not be reached.",
          uncertain:
            cause instanceof ZeropsApiError &&
            (cause.kind === "network" || cause.kind === "uncertain"),
        };
      }
      if (outcome.ok) {
        record = { ...record, step: "done" };
        return receipt(null, true);
      }
      const stopped = publish(outcome);
      return outcome.uncertain
        ? ({
            unobservable: {
              nextActor: "person",
              nextAction: "Press Again to read HQ's setup journal.",
              reason: outcome.reason,
            },
          } satisfies OwnerUnobservable)
        : stopped;
    });
}
