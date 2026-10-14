/**
 * Zerops writes to a place's addresses. A domain or port write is sent, then the project's
 * routings of its kind are put in place: the receipt follows that process. Where no process
 * follows — Zerops refusing the second step as `nothingToSync` (somebody else's sync took it
 * live, read 2026-10-14), or naming none — the routings say its end. A second step refused after
 * the first was taken leaves the write waiting there, putting it live the person's next step; a
 * refused first step sends no second.
 *
 * @module data/operations/executors/addressWrites
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ZeropsPortRoutingWrite } from "../../../zerops/api.ts";
import type { Family, OperationReceipt } from "../../model.ts";
import type { PortRoutingWrite } from "../addressWrites.ts";
import type { OwnerUnobservable } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { processReceipt } from "./serviceWrites.ts";
import { verb } from "./write.ts";

type Process = Promise<{ readonly processId: string | undefined }>;

export interface AddressPlatform {
  readonly createPublicHttpRouting: (
    projectId: string,
    routing: {
      readonly domains: ReadonlyArray<string>;
      readonly locations: ReadonlyArray<{
        readonly path: string;
        readonly port: number;
        readonly serviceStackId: string;
      }>;
    },
  ) => Promise<void>;
  readonly updatePublicHttpRouting: (
    routingId: string,
    routing: {
      readonly domains: ReadonlyArray<string>;
      readonly locations: ReadonlyArray<{
        readonly path: string;
        readonly port: number;
        readonly serviceStackId: string;
      }>;
      readonly sslEnabled: boolean;
    },
  ) => Promise<void>;
  readonly deletePublicHttpRouting: (routingId: string) => Promise<void>;
  readonly checkPublicHttpRoutingDns: (routingId: string) => Promise<void>;
  readonly syncPublicHttpRouting: (projectId: string) => Process;
  readonly disableSubdomainAccess: (serviceId: string) => Process;
  readonly createPublicPortRouting: (
    serviceId: string,
    port: ZeropsPortRoutingWrite,
  ) => Promise<void>;
  readonly updatePublicPortRouting: (id: string, port: ZeropsPortRoutingWrite) => Promise<void>;
  readonly deletePublicPortRouting: (id: string) => Promise<void>;
  readonly syncPublicPortRouting: (projectId: string) => Process;
  readonly requestProjectPublicIp: (projectId: string) => Process;
}

const NOTHING_TO_SYNC = "nothingToSync";

type Target = { readonly family: Family; readonly id: string };

/** A write Zerops took that no process follows: what its routings show ends it. */
const unfollowedReceipt = (requestId: string, target: Target): OperationReceipt => ({
  requestId,
  operationId: target.id,
  executor: "zerops",
  affected: [target],
  handles: [],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
});

const portOf = ({ serviceId: _service, ...port }: PortRoutingWrite): ZeropsPortRoutingWrite => ({
  publicIpType: port.publicIpType,
  publicPort: port.publicPort,
  internalPort: port.internalPort,
  internalProtocol: port.internalProtocol,
  firewallPolicy: port.firewallPolicy,
  firewallIpRanges: port.firewallIpRanges,
});

export function addressWritesExecutor(platform: AddressPlatform) {
  /**
   * The project's routings of a kind put in place, as the receipt of what was `written` before:
   * a write of the sheet's (`true`), or only the waiting ones put live (`false`).
   */
  const putInPlace = (requestId: string, sync: () => Process, target: Target, written: boolean) =>
    Effect.gen(function* () {
      const synced = yield* Effect.result(verb(sync));
      if (Result.isSuccess(synced)) {
        const { processId } = synced.success;
        return processId === undefined
          ? unfollowedReceipt(requestId, target)
          : processReceipt(requestId, target, processId);
      }
      const fault = synced.failure;
      if ("code" in fault && fault.code === NOTHING_TO_SYNC)
        return unfollowedReceipt(requestId, target);
      // A lost answer is the coordinator's to resolve, by what the routings show.
      if (!written || fault.outcome === "uncertain-acceptance") return yield* Effect.fail(fault);
      return {
        unobservable: {
          nextActor: "person",
          nextAction: "Put the waiting change live",
          reason: fault.message,
        },
        receipt: unfollowedReceipt(requestId, target),
      } satisfies OwnerUnobservable;
    });
  const domains = (requestId: string, projectId: string, target: string, written = true) =>
    putInPlace(
      requestId,
      () => platform.syncPublicHttpRouting(projectId),
      { family: "publicRouting", id: target },
      written,
    );
  const ports = (requestId: string, projectId: string, target: string, written = true) =>
    putInPlace(
      requestId,
      () => platform.syncPublicPortRouting(projectId),
      { family: "publicPortRouting", id: target },
      written,
    );

  return {
    addDomain: (requestId: string, intent: IntentOf<"add-domain">) =>
      verb(() =>
        platform.createPublicHttpRouting(intent.projectId, {
          domains: intent.domains,
          locations: [{ path: "/", port: intent.port, serviceStackId: intent.serviceId }],
        }),
      ).pipe(Effect.andThen(domains(requestId, intent.projectId, intent.projectId))),
    removeDomain: (requestId: string, intent: IntentOf<"remove-domain">) =>
      verb(() =>
        intent.keep.length === 0
          ? platform.deletePublicHttpRouting(intent.routingId)
          : platform.updatePublicHttpRouting(intent.routingId, {
              domains: intent.keep,
              locations: intent.locations,
              sslEnabled: intent.sslEnabled,
            }),
      ).pipe(Effect.andThen(domains(requestId, intent.projectId, intent.routingId))),
    checkDomainDns: (requestId: string, intent: IntentOf<"check-domain-dns">) =>
      Effect.as(
        verb(() => platform.checkPublicHttpRoutingDns(intent.routingId)),
        answeredReceipt(requestId, { family: "publicRouting", id: intent.routingId }),
      ),
    publishDomains: (requestId: string, intent: IntentOf<"publish-domains">) =>
      domains(requestId, intent.projectId, intent.projectId, false),
    disableSubdomainAccess: (requestId: string, intent: IntentOf<"disable-subdomain-access">) =>
      Effect.map(
        verb(() => platform.disableSubdomainAccess(intent.serviceId)),
        ({ processId }) =>
          processReceipt(requestId, { family: "service", id: intent.serviceId }, processId),
      ),
    openPort: (requestId: string, intent: IntentOf<"open-port">) =>
      verb(() => platform.createPublicPortRouting(intent.serviceId, portOf(intent))).pipe(
        Effect.andThen(ports(requestId, intent.projectId, intent.projectId)),
      ),
    changePort: (requestId: string, intent: IntentOf<"change-port">) =>
      verb(() => platform.updatePublicPortRouting(intent.portRoutingId, portOf(intent))).pipe(
        Effect.andThen(ports(requestId, intent.projectId, intent.portRoutingId)),
      ),
    closePort: (requestId: string, intent: IntentOf<"close-port">) =>
      verb(() => platform.deletePublicPortRouting(intent.portRoutingId)).pipe(
        Effect.andThen(ports(requestId, intent.projectId, intent.portRoutingId)),
      ),
    publishPorts: (requestId: string, intent: IntentOf<"publish-ports">) =>
      ports(requestId, intent.projectId, intent.projectId, false),
    requestIpv4: (requestId: string, intent: IntentOf<"request-ipv4">) =>
      Effect.map(
        verb(() => platform.requestProjectPublicIp(intent.projectId)),
        ({ processId }) =>
          processReceipt(requestId, { family: "project", id: intent.projectId }, processId),
      ),
  };
}
