/** The gate reads setup progress from operations; recovery still belongs to HQ's project-env journal. */
import { hqBirthProgress, type HqBirthProgress } from "@t3tools/client-runtime/data";
import type { HqBirthStep } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";

import { useProjection } from "./ZeropsAccountData";

const NOT_STARTED = Atom.make<HqBirthProgress | null>(null);

export function useHqBirths(orgId: string): HqBirthProgress | null {
  return useProjection(hqBirthProgress, orgId, NOT_STARTED);
}

export type HqBirthView =
  | { readonly kind: "running"; readonly step: HqBirthStep | "done" }
  | { readonly kind: "failed"; readonly step: HqBirthStep; readonly reason: string };

export function hqBirthView(held: HqBirthProgress | null): HqBirthView | undefined {
  if (held === null) return undefined;
  if (held.failed === null) return { kind: "running", step: held.record.step };
  return { kind: "failed", step: held.failed.step, reason: held.failed.reason };
}
