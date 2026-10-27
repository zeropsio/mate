/**
 * HQ's birth's waits, on the account's store alone (`projections/hqBirth.ts`): each resolves once
 * Zerops's facts say so and holds HQ's project history while it waits, so an end that came while
 * the link was away is read in its next baseline. A wait ends visibly where Zerops can no longer be
 * followed; no clock decides one.
 *
 * @module data/hqBirthWaits
 */
import type { Atom, AtomRegistry } from "effect/reactivity";

import { ZeropsApiError } from "../zerops/api.ts";
import type { DetailDemand } from "./demand.ts";
import {
  hqBirthProcess,
  hqBirthServices,
  hqBirthZone,
  type HqBirthProcess,
  type HqBirthServices,
  type HqBirthZone,
} from "./projections/hqBirth.ts";
import type { AccountStore } from "./store.ts";

/** What a wait says once its facts can no longer be followed here. */
export const HQ_BIRTH_UNFOLLOWED =
  "Zerops can no longer be followed here. Press Again to continue HQ's setup.";

export interface HqBirthWaits {
  /** Core's service and every service's id, once HQ's services are up and its imports ended. */
  readonly untilServices: (
    orgId: string,
    projectId: string,
  ) => Promise<{
    readonly serviceId: string;
    readonly serviceIds: Readonly<Record<string, string>>;
  }>;
  /** HQ's project's domain, once Zerops gave it one. */
  readonly untilZone: (orgId: string, projectId: string) => Promise<string>;
  /** How a process of HQ's project ended. */
  readonly untilProcessEnds: (
    orgId: string,
    projectId: string,
    processId: string,
  ) => Promise<string>;
}

export function hqBirthWaits(input: {
  readonly data: AccountStore["data"];
  readonly registry: AtomRegistry.AtomRegistry;
  readonly demandDetail: (demand: DetailDemand) => () => void;
}): HqBirthWaits {
  /** Settles once `decide` says, holding `projectId`'s process history meanwhile. */
  const until = <A, B>(
    projectId: string,
    atom: Atom.Atom<A>,
    decide: (value: A) => { readonly done: B } | { readonly stop: Error } | null,
  ) =>
    new Promise<B>((resolve, reject) => {
      const release = input.demandDetail({
        family: "process",
        listing: "history",
        ownerId: projectId,
      });
      let ended = false;
      let cancel: (() => void) | undefined;
      cancel = input.registry.subscribe(
        atom,
        (value) => {
          if (ended) return;
          const decided = decide(value);
          if (decided === null) return;
          ended = true;
          if ("done" in decided) resolve(decided.done);
          else reject(decided.stop);
          cancel?.();
          release();
        },
        { immediate: true },
      );
      // Its first value may have ended it before its subscription was in hand.
      if (ended) cancel();
    });
  return {
    untilServices: (orgId, projectId) =>
      until<
        HqBirthServices,
        { readonly serviceId: string; readonly serviceIds: Readonly<Record<string, string>> }
      >(projectId, input.data.project(hqBirthServices, { orgId, projectId }), (services) => {
        switch (services.kind) {
          case "waiting":
            return null;
          case "unobserved":
            return { stop: new ZeropsApiError(HQ_BIRTH_UNFOLLOWED, "uncertain") };
          case "stopped":
            return { stop: new Error(services.reason) };
          case "up":
            return { done: { serviceId: services.serviceId, serviceIds: services.serviceIds } };
        }
      }),
    untilZone: (orgId, projectId) =>
      until<HqBirthZone, string>(
        projectId,
        input.data.project(hqBirthZone, { orgId, projectId }),
        (zone) =>
          zone.kind === "zone"
            ? { done: zone.zone }
            : zone.kind === "unobserved"
              ? { stop: new ZeropsApiError(HQ_BIRTH_UNFOLLOWED, "uncertain") }
              : null,
      ),
    untilProcessEnds: (orgId, projectId, processId) =>
      until<HqBirthProcess, string>(
        projectId,
        input.data.project(hqBirthProcess, { orgId, projectId, processId }),
        (process) =>
          process.kind === "ended"
            ? { done: process.status }
            : process.kind === "unobserved"
              ? { stop: new ZeropsApiError(HQ_BIRTH_UNFOLLOWED, "uncertain") }
              : null,
      ),
  };
}
