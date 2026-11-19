/**
 * Zerops writes to a place's addresses. A domain or port write is one request, in place once
 * Zerops answers it (Zerops dropped publishing public routings; its own app sends no second step
 * since): what the routings show ends it, so the sheet's own row gives way to the routing's.
 *
 * @module data/operations/executors/addressWrites
 */
import * as Effect from "effect/Effect";

import type { ZeropsPortRoutingWrite } from "../../../zerops/api/routing.ts";
import type { Family, OperationReceipt } from "../../model.ts";
import type { PortRoutingWrite } from "../addressWrites.ts";
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
  readonly disableSubdomainAccess: (serviceId: string) => Process;
  readonly createPublicPortRouting: (
    serviceId: string,
    port: ZeropsPortRoutingWrite,
  ) => Promise<void>;
  readonly updatePublicPortRouting: (id: string, port: ZeropsPortRoutingWrite) => Promise<void>;
  readonly deletePublicPortRouting: (id: string) => Promise<void>;
  readonly requestProjectPublicIp: (projectId: string) => Process;
}

type Target = { readonly family: Family; readonly id: string };

/** A write Zerops took that no process follows: what its routings show ends it. */
const routedReceipt = (requestId: string, target: Target): OperationReceipt => ({
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
  /** The write sent; once Zerops answers, what the routings show ends it. */
  const routed = (requestId: string, target: Target, send: () => Promise<void>) =>
    Effect.as(verb(send), routedReceipt(requestId, target));

  return {
    addDomain: (requestId: string, intent: IntentOf<"add-domain">) =>
      routed(requestId, { family: "publicRouting", id: intent.projectId }, () =>
        platform.createPublicHttpRouting(intent.projectId, {
          domains: intent.domains,
          locations: [{ path: "/", port: intent.port, serviceStackId: intent.serviceId }],
        }),
      ),
    removeDomain: (requestId: string, intent: IntentOf<"remove-domain">) =>
      routed(requestId, { family: "publicRouting", id: intent.routingId }, () =>
        intent.keep.length === 0
          ? platform.deletePublicHttpRouting(intent.routingId)
          : platform.updatePublicHttpRouting(intent.routingId, {
              domains: intent.keep,
              locations: intent.locations,
              sslEnabled: intent.sslEnabled,
            }),
      ),
    checkDomainDns: (requestId: string, intent: IntentOf<"check-domain-dns">) =>
      Effect.as(
        verb(() => platform.checkPublicHttpRoutingDns(intent.routingId)),
        answeredReceipt(requestId, { family: "publicRouting", id: intent.routingId }),
      ),
    disableSubdomainAccess: (requestId: string, intent: IntentOf<"disable-subdomain-access">) =>
      Effect.map(
        verb(() => platform.disableSubdomainAccess(intent.serviceId)),
        ({ processId }) =>
          processReceipt(requestId, { family: "service", id: intent.serviceId }, processId),
      ),
    openPort: (requestId: string, intent: IntentOf<"open-port">) =>
      routed(requestId, { family: "publicPortRouting", id: intent.projectId }, () =>
        platform.createPublicPortRouting(intent.serviceId, portOf(intent)),
      ),
    changePort: (requestId: string, intent: IntentOf<"change-port">) =>
      routed(requestId, { family: "publicPortRouting", id: intent.portRoutingId }, () =>
        platform.updatePublicPortRouting(intent.portRoutingId, portOf(intent)),
      ),
    closePort: (requestId: string, intent: IntentOf<"close-port">) =>
      routed(requestId, { family: "publicPortRouting", id: intent.portRoutingId }, () =>
        platform.deletePublicPortRouting(intent.portRoutingId),
      ),
    requestIpv4: (requestId: string, intent: IntentOf<"request-ipv4">) =>
      Effect.map(
        verb(() => platform.requestProjectPublicIp(intent.projectId)),
        ({ processId }) =>
          processReceipt(requestId, { family: "project", id: intent.projectId }, processId),
      ),
  };
}
