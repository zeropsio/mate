/**
 * The Zerops datastream as the account harness serves it (DESIGN §11.1): a
 * `ZeropsDataAdapter` whose receivers, registrations and reads answer from the
 * same platform `FakeZeropsRest` holds, decoded by the real protocol decoders.
 *
 * It answers the account a ref names only from organizations that account
 * belongs to, as the REST half does: a receiver, a registration or a read for
 * anyone else fails `forbidden`.
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  decodeEntityDirectResponse,
  decodeRegistrationResponse,
} from "../data/platformProtocol.ts";
import type {
  AdapterError,
  OrganizationRef,
  RegistrationRequest,
  ZeropsDataAdapter,
} from "../data/types.ts";
import type { FakeZeropsRest } from "./fakeZeropsRest.ts";

export interface FakeDatastream {
  readonly adapter: ZeropsDataAdapter;
  /** Every registration the runtime made, in order. */
  readonly registrations: () => ReadonlyArray<RegistrationRequest>;
  /**
   * Registrations wait until released: the push half of a round left
   * establishing after its REST half has finished.
   */
  readonly holdRegistrations: () => { readonly release: () => void };
}

const failure = (kind: "forbidden" | "not-found", message: string): AdapterError => ({
  _tag: "ZeropsDataAdapterError",
  kind,
  message,
  retryable: false,
  accountRevocationEvidence: false,
});

const forbidden = failure("forbidden", "Zerops rejected the request (forbidden).");

export function makeFakeDatastream(
  platform: Pick<FakeZeropsRest, "project" | "projectsOf" | "memberOf">,
): FakeDatastream {
  const registrations: RegistrationRequest[] = [];
  let held: Promise<void> | null = null;
  const admits = (organization: OrganizationRef, clientId: string = organization.organizationId) =>
    platform.memberOf(organization.account.accountId, clientId);
  return {
    adapter: {
      openReceiver: (scope, organization, identity) =>
        scope.account.accountId === organization.account.accountId && admits(organization)
          ? Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            })
          : Effect.fail(forbidden),
      register: (receiver, request) => {
        const organization =
          request.descriptor.kind === "entity-updates"
            ? request.descriptor.organization
            : request.descriptor.query.kind === "projects-of-organization"
              ? request.descriptor.query.organization
              : receiver.organization;
        if (!admits(receiver.organization, organization.organizationId))
          return Effect.fail(forbidden);
        return Effect.promise(() => {
          registrations.push(request);
          return held ?? Promise.resolve();
        }).pipe(
          Effect.map(() => {
            if (request.descriptor.kind === "entity-updates") return { responseObservations: [] };
            const query = request.descriptor.query;
            const items =
              query.kind === "projects-of-organization"
                ? platform.projectsOf(query.organization.organizationId)
                : [];
            return {
              responseObservations: decodeRegistrationResponse(request, {
                items,
                total: items.length,
              }).observations,
            };
          }),
        );
      },
      read: (ticket) => {
        if (ticket.target.kind !== "project") return Effect.succeed({ observations: [] });
        const { ref } = ticket.target;
        const project = platform.project(ref.projectId);
        if (project === undefined)
          return Effect.fail(failure("not-found", "Zerops no longer has this project."));
        if (!admits(ref.organization, project.clientId)) return Effect.fail(forbidden);
        return Effect.succeed({
          observations: decodeEntityDirectResponse(ticket, project).observations,
        });
      },
      execute: () => Effect.succeed({ processRefs: [], observations: [] }),
      closeReceiver: () => Effect.void,
    },
    registrations: () => [...registrations],
    holdRegistrations: () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      held = gate;
      return {
        release: () => {
          if (held === gate) held = null;
          release();
        },
      };
    },
  };
}
