/** Mobile follows the same HQ navigation setup evidence and close-off gate as web. */
import type { HqMateSetup } from "@t3tools/client-runtime/data";
import { closeOffGate } from "@t3tools/client-runtime/zerops/environments";

/** Why a held Mate does not open on the phone. */
export const CLOSE_OFF_STOPPED_LINE =
  "Its setup stopped before its project was closed off. Finish setup on the web closes it off.";

/** The projects this device knows are not closed off, as the account's environments read them. */
export interface CloseOffFacts {
  readonly read: () => ReadonlySet<string>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly hold: (projectId: string, held: boolean) => void;
}

export function makeCloseOffFacts(): CloseOffFacts {
  let held: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    read: () => held,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hold: (projectId, hold) => {
      if (held.has(projectId) === hold) return;
      const next = new Set(held);
      if (hold) next.add(projectId);
      else next.delete(projectId);
      held = next;
      for (const listener of listeners) listener();
    },
  };
}

/** This device's facts, for its one account's environments (`environment-ports.ts`). */
export const closeOffFacts = makeCloseOffFacts();

/** A known hold survives an outage until HQ proves completion or an absent marker. */
export function checkCloseOff(
  facts: CloseOffFacts,
  input: { readonly projectId: string; readonly setup: HqMateSetup },
): "held" | "clear" {
  const held =
    closeOffGate({
      ...input.setup,
      pendingHere: facts.read().has(input.projectId),
    }) !== "connect";
  facts.hold(input.projectId, held);
  return held ? "held" : "clear";
}
