/**
 * The Zerops datastream as the account harness serves it (DESIGN §11.1): a
 * `ZeropsDataAdapter` whose receivers, registrations and reads answer from the
 * same platform `FakeZeropsRest` holds, decoded by the real protocol decoders.
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  decodeEntityDirectResponse,
  decodeRegistrationResponse,
} from "../data/platformProtocol.ts";
import type { RegistrationRequest, ZeropsDataAdapter } from "../data/types.ts";
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

export function makeFakeDatastream(
  platform: Pick<FakeZeropsRest, "project" | "projectsOf">,
): FakeDatastream {
  const registrations: RegistrationRequest[] = [];
  let held: Promise<void> | null = null;
  return {
    adapter: {
      openReceiver: (_scope, organization, identity) =>
        Effect.succeed({
          identity,
          organization,
          delivery: "hot-single-consumer-buffered-before-open-resolves",
          events: Stream.never,
        }),
      register: (_receiver, request) =>
        Effect.promise(() => {
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
        ),
      read: (ticket) => {
        if (ticket.target.kind !== "project") return Effect.succeed({ observations: [] });
        const project = platform.project(ticket.target.ref.projectId);
        return project === undefined
          ? Effect.fail({
              _tag: "ZeropsDataAdapterError",
              kind: "not-found",
              message: "Zerops no longer has this project.",
              retryable: false,
              accountRevocationEvidence: false,
            })
          : Effect.succeed({
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
