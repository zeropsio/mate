/**
 * A Mate as this tab reads it from the Mate itself: one value per Mate target (`projectId:serviceId`),
 * written by the Mate adapter (`adapters/mate.ts`) after each batch of what it read — a probe of
 * the container, the door's answer, the link the connection registry reports — as its two machines
 * stand then: the environment machine (presence, credential, link) and the container machine.
 * Listed under its project's Mate link, `mate:<projectId>:link`. A Mate the listing no longer
 * names, and no demand holds, stays read but is no longer shown: nothing deletes it but its own
 * retirement.
 *
 * @module data/families/mateLink
 */
import type { ContainerMachine } from "../../zerops/environments/containerMachine.ts";
import type { EnvironmentMachine } from "../../zerops/environments/environmentMachine.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface MateLinkValue {
  /** `projectId:serviceId`. */
  readonly key: string;
  readonly projectId: string;
  /** The organization that lists its project; null while none does (a route to it alone). */
  readonly orgId: string | null;
  /** Where its Mate is reached, as the listing or the session kept for it names it. */
  readonly origin: string | null;
  /** Listed in the organization shown, or held by a demand: surfaces draw it. */
  readonly shown: boolean;
  readonly environment: EnvironmentMachine;
  readonly container: ContainerMachine;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateLink: MateLinkValue;
  }
}

/** The index of the Mates shown, under its one key. */
export const SHOWN_MATES = { name: "mateLinkShown", key: "shown" } as const;

export const mateLinkFamily: FamilySpec<"mateLink"> = {
  family: "mateLink",
  authority: "mate",
  scope: { source: "mate", suffix: "link", leaving: "removed", demand: "detail" },
  indexes: [{ name: SHOWN_MATES.name, keyOf: (value) => (value.shown ? SHOWN_MATES.key : null) }],
};

/** A Mate project's link scope: the targets of its project the adapter reads. */
export const mateLinkScope = (projectId: string): ScopeKey => scopeOf(mateLinkFamily, projectId);
