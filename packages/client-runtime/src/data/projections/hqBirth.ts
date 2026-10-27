/**
 * What HQ's birth waits on, as Zerops's facts in the account's store say it — never a read on a
 * clock: its project's services all up and its imports ended, its project's domain, one process's
 * end. Each says `unobserved` once the organization's link, or HQ's project's history, observes
 * nothing more: the wait then ends visibly, its step "could not be followed".
 *
 * @module data/projections/hqBirth
 */
import { detailScopeOf } from "../demand.ts";
import { runsStill } from "../families/process.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { PROJECT_CREATE_ACTION } from "../../zerops/projectCreation.ts";
import { sameValue } from "./equal.ts";
import { UNOBSERVED_PHASES } from "./operationEnd.ts";
import { projectServices } from "./services.ts";

/** The services HQ's birth waits on: Core's, its Postgres and its volume. */
const HQ_SERVICES = ["db", "vol", "hq"] as const;
const FAILED: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

type BirthKey = { readonly orgId: string; readonly projectId: string };

/** Whether the organization's link, or the project's history where held, observes nothing more. */
const unobserved = (read: ProjectionReads, { orgId, projectId }: BirthKey) =>
  UNOBSERVED_PHASES.has(read.stream(linkKeys.zerops(orgId)).phase) ||
  UNOBSERVED_PHASES.has(
    read.stream(detailScopeOf(orgId, { family: "process", listing: "history", ownerId: projectId }))
      .phase,
  );

export type HqBirthServices =
  | { readonly kind: "waiting" | "unobserved" }
  | {
      readonly kind: "up";
      /** Core's service. */
      readonly serviceId: string;
      readonly serviceIds: Readonly<Record<string, string>>;
    }
  | { readonly kind: "stopped"; readonly reason: string };

export const hqBirthServices: Projection<BirthKey, HqBirthServices> = {
  name: "hqBirthServices",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  equals: sameValue,
  derive: (read, key) => {
    for (const id of read.index("project", key.projectId)) {
      const process = read.fact("process", id);
      if (process.kind !== "known" || !FAILED.has(process.value.status)) continue;
      return {
        kind: "stopped",
        reason:
          process.value.actionName === PROJECT_CREATE_ACTION
            ? `${process.value.error?.message ?? "HQ's project creation failed"}. Inspect its creation process in Zerops, then press Again.`
            : `HQ's service import is ${process.value.status}. Inspect process ${id} in Zerops, fix the cause, then press Again.`,
      };
    }
    const services = projectServices.derive(read, key).services ?? [];
    const failed = services.find((service) => FAILED.has(service.status));
    if (failed !== undefined)
      return {
        kind: "stopped",
        reason: `HQ's ${failed.name} service is ${failed.status}. Inspect its import process in Zerops, then press Again.`,
      };
    if (unobserved(read, key)) return { kind: "unobserved" };
    const named = (name: string) => services.find((service) => service.name === name);
    const hq = named("hq");
    // Up once each is active and none of its imports runs still.
    if (
      hq === undefined ||
      !HQ_SERVICES.every((name) => named(name)?.status === "ACTIVE") ||
      read.index("running", key.projectId).size > 0
    )
      return { kind: "waiting" };
    return {
      kind: "up",
      serviceId: hq.id,
      serviceIds: Object.fromEntries(services.map((service) => [service.name, service.id])),
    };
  },
};

export type HqBirthZone =
  | { readonly kind: "waiting" | "unobserved" }
  | { readonly kind: "zone"; readonly zone: string };

export const hqBirthZone: Projection<BirthKey, HqBirthZone> = {
  name: "hqBirthZone",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  equals: sameValue,
  derive: (read, key) => {
    const project = read.fact("project", key.projectId);
    const zone = project.kind === "known" ? project.value.publicZone : undefined;
    if (typeof zone === "string" && zone.length > 0) return { kind: "zone", zone };
    return { kind: unobserved(read, key) ? "unobserved" : "waiting" };
  },
};

export type HqBirthProcess =
  | { readonly kind: "waiting" | "unobserved" }
  | { readonly kind: "ended"; readonly status: string };

export const hqBirthProcess: Projection<BirthKey & { readonly processId: string }, HqBirthProcess> =
  {
    name: "hqBirthProcess",
    keyOf: ({ orgId, projectId, processId }) => `${orgId}/${projectId}/${processId}`,
    equals: sameValue,
    derive: (read, key) => {
      const process = read.fact("process", key.processId);
      if (process.kind === "known" && !runsStill(process.value.status))
        return { kind: "ended", status: process.value.status };
      return { kind: unobserved(read, key) ? "unobserved" : "waiting" };
    },
  };
