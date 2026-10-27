/** The gate reads setup progress from operations; recovery still belongs to HQ's project-env journal. */
import { hqBirthProgress, type HqBirthProgress } from "@t3tools/client-runtime/data";
import type { HqBirthStep } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";

import { useProjection } from "./ZeropsAccountData";

const NOT_STARTED = Atom.make<HqBirthProgress | null>(null);

export function useHqBirths(orgId: string): HqBirthProgress | null {
  return useProjection(hqBirthProgress, orgId, NOT_STARTED);
}

export type HqBirthView = (
  | { readonly kind: "running"; readonly step: HqBirthStep | "done" }
  | { readonly kind: "failed"; readonly step: HqBirthStep; readonly reason: string }
) & {
  /** When the setup began (epoch ms), as its record keeps it; absent on an older record. */
  readonly startedAt?: number;
};

export function hqBirthView(held: HqBirthProgress | null): HqBirthView | undefined {
  if (held === null) return undefined;
  const began = held.record.startedAt === undefined ? {} : { startedAt: held.record.startedAt };
  if (held.failed === null) return { kind: "running", step: held.record.step, ...began };
  return { kind: "failed", step: held.failed.step, reason: held.failed.reason, ...began };
}

/**
 * Where this page stands with its organization's HQ setup: one it watched run (`running`) and
 * finish (`born`) keeps the finished setup on screen until the menu has read the new HQ
 * (`released`); a setup finished before the page loaded is never held (`unseen`).
 */
export type HqBirthWatch = "unseen" | "running" | "born" | "released";

export function watchHqBirth(
  watch: HqBirthWatch,
  input: {
    readonly birth: HqBirthView | undefined;
    /** The menu's sources answered for the organization (`useMenuRows`). */
    readonly menuSettled: boolean;
  },
): HqBirthWatch {
  const { birth } = input;
  const running = birth?.kind === "running" && birth.step !== "done";
  const done = birth?.kind === "running" && birth.step === "done";
  switch (watch) {
    case "unseen":
      return running ? "running" : "unseen";
    case "running":
      return done
        ? input.menuSettled
          ? "released"
          : "born"
        : birth === undefined
          ? "unseen"
          : "running";
    case "born":
      return input.menuSettled ? "released" : "born";
    case "released":
      return "released";
  }
}
