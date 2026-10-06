/**
 * An accepted operation is a standing demand at its owner: the detail that holds its
 * handle — declared by its kind's `observedIn` — is held through the same `demandDetail` screens
 * use, from acceptance until the operation is done or refused. An end that came while the account
 * was away is then read in that detail's next baseline, and settles the operation.
 *
 * Our own write is read back where a screen shows it: once its owner accepted it, each member it
 * affected whose own row a screen holds (a family's `member` listing) is read again, once — no push
 * is promised to bring what it changed (a project's grants).
 *
 * @module data/operations/standing
 */
import type { DetailDemand } from "../demand.ts";
import { familySpec } from "../families/index.ts";
import { operationProgressOf } from "../projections/operation.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { OPERATION_KINDS, operationKind } from "./kinds.ts";

/** Holds every open operation's detail for as long as it stays open; the result stops holding. */
export function holdStandingDemands(options: {
  readonly store: AccountStore;
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Reads a held detail again after our own write to it. */
  readonly readAgain: (demand: DetailDemand) => void;
  /** The operation kinds; the account's registry unless a test brings its own. */
  readonly kinds?: ReadonlyArray<RegisteredOperationKind>;
}): () => void {
  const { store } = options;
  const kinds = options.kinds ?? OPERATION_KINDS;
  const progress = operationProgressOf(kinds);
  const held = new Map<string, () => void>();
  /** The operations whose accepted writes were read back already. */
  const readBack = new Set<string>();

  // Holding or releasing dispatches to the store, which calls back here: such a call only asks for
  // one more pass once this one ends, so a hold is never taken twice.
  let running = false;
  let again = false;
  const reconcile = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        pass();
      } while (again);
    } finally {
      running = false;
    }
  };

  const pass = () => {
    const state = store.state();
    const read = readsOfState(state);
    const open = new Map<string, DetailDemand>();
    for (const [requestId, record] of state.operations) {
      const { receipt } = record;
      if (receipt === null || receipt.acceptance.kind !== "accepted") continue;
      if (!readBack.has(requestId)) {
        readBack.add(requestId);
        for (const { family, id } of receipt.affected)
          for (const listing of familySpec(family).details ?? [])
            if (listing.member === true)
              options.readAgain({ family, listing: listing.suffix, ownerId: id });
      }
      const stage = progress.derive(read, requestId).stage;
      if (stage === "done" || stage === "refused") continue;
      const demand = operationKind(kinds, record.intent).observedIn?.(record.intent, receipt);
      if (demand !== null && demand !== undefined) open.set(requestId, demand);
    }
    for (const [requestId, release] of held)
      if (!open.has(requestId)) {
        held.delete(requestId);
        release();
      }
    for (const [requestId, demand] of open)
      if (!held.has(requestId)) held.set(requestId, options.demandDetail(demand));
  };

  const stopListening = store.subscribe(reconcile);
  reconcile();
  return () => {
    stopListening();
    for (const release of held.values()) release();
    held.clear();
  };
}
