/**
 * The addresses sheet's writes, per place: each one submitted as one of the account's operations
 * and followed to its end, our writes in flight kept by the control they hold busy, why the last
 * one of a control failed, and the writes whose answer was lost — which may have landed. Kept
 * outside the sheet, so a sheet closed, opened again or moved to another place still shows them.
 */
import type { OperationEnd, OperationProgress } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { create } from "zustand";

import type { AccountOperations } from "~/zerops/accountOperations";
import { writeTrouble } from "~/zerops/zeropsWrite";

import { addressTrouble, writeKey, type AddressWrite } from "./addresses.logic";

export interface PlaceKey {
  readonly orgId: string;
  readonly projectId: string;
}

export const placeKeyOf = ({ orgId, projectId }: PlaceKey) => `${orgId}/${projectId}`;

export interface PlaceFlights {
  /** Our writes under way, by `writeKey`. */
  readonly flights: Readonly<Record<string, AddressWrite>>;
  /** Why the last write of a control failed, by `writeKey`. */
  readonly trouble: Readonly<Record<string, string>>;
  /** Writes whose answer was lost: they may have landed, so they are not offered again. */
  readonly unsure: Readonly<Record<string, true>>;
}

export const NO_PLACE_FLIGHTS: PlaceFlights = { flights: {}, trouble: {}, unsure: {} };

interface FlightsState {
  readonly byPlace: Readonly<Record<string, PlaceFlights>>;
}

export const useAddressFlights = create<FlightsState>(() => ({ byPlace: {} }));

function change(place: string, edit: (held: PlaceFlights) => PlaceFlights) {
  useAddressFlights.setState((state) => ({
    byPlace: { ...state.byPlace, [place]: edit(state.byPlace[place] ?? NO_PLACE_FLIGHTS) },
  }));
}

const without = <T>(record: Readonly<Record<string, T>>, key: string) => {
  const { [key]: _gone, ...rest } = record;
  return rest;
};

/** What answers a write: the account's operations, or a test's own. */
export type WriteOwner = Pick<AccountOperations, "submit" | "untilEnd">;

type Intent = Parameters<AccountOperations["submit"]>[0];

/** What the person is told of a write Zerops did not take, or that ended failed. */
function troubleOf(
  progress: OperationProgress,
  evidence: string | null,
  write: AddressWrite,
): string | null {
  if (progress.stage === "refused") return addressTrouble(progress.code, write) ?? progress.reason;
  return writeTrouble(progress, evidence);
}

/**
 * Submits one write for a place. `taken` once Zerops answered: `true` where it took the write, or
 * its answer was lost and is being asked again; `false` where it refused, the trouble saying why,
 * or the control is busy already. `ended` once the write is followed to its end.
 */
export async function runAddressWrite(
  owner: WriteOwner,
  place: PlaceKey,
  write: AddressWrite,
  /** Whether the account that asked is still the one signed in. */
  isCurrent: () => boolean = () => true,
): Promise<{ readonly taken: boolean; readonly ended: Promise<void> }> {
  const key = placeKeyOf(place);
  const control = writeKey(write);
  if (useAddressFlights.getState().byPlace[key]?.flights[control] !== undefined)
    return { taken: false, ended: Promise.resolve() };
  change(key, (held) => ({
    flights: { ...held.flights, [control]: write },
    trouble: without(held.trouble, control),
    unsure: without(held.unsure, control),
  }));
  const finish = (trouble: string | null, unsure = false) => {
    change(key, (held) => ({
      flights: without(held.flights, control),
      trouble:
        trouble === null || !isCurrent() ? held.trouble : { ...held.trouble, [control]: trouble },
      unsure: unsure ? { ...held.unsure, [control]: true } : held.unsure,
    }));
  };
  try {
    const { requestId, progress, evidence } = await owner.submit({
      ...write,
      orgId: place.orgId,
    } as Intent);
    // A lost answer is asked again: followed to its end like a taken one.
    if (progress.stage !== "uncertain") {
      const refused = troubleOf(progress, evidence, write);
      if (refused !== null) {
        finish(refused);
        return { taken: false, ended: Promise.resolve() };
      }
    }
    const ended = owner.untilEnd(requestId, place.orgId).then(
      (end: NonNullable<OperationEnd>) => {
        if (end.stage === "unobserved") finish(null);
        else finish(troubleOf(end, null, write), end.stage === "uncertain");
      },
      (cause: unknown) => finish(zeropsErrorMessage(cause)),
    );
    return { taken: true, ended };
  } catch (cause) {
    finish(zeropsErrorMessage(cause));
    return { taken: false, ended: Promise.resolve() };
  }
}
