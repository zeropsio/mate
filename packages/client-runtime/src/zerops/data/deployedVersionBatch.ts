/**
 * What services run, read together (A14). Every runtime service a deployment stop shows asks what
 * it runs, and a cold load asks for all of them in the same moment: read one by one that was a
 * `GET /service-stack/{id}` per service — over a hundred requests, each with its CORS preflight,
 * for one organization. Asked for together, an organization's services are answered by its two
 * searches (`readServicesDeploys`) whatever their count, the way the platform's own app reads.
 *
 * A service asked for alone is read by id: that is the deploy that just activated, which the
 * lag-free read sees first. A service the searches do not carry yet is read by id too.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { ZeropsApiClient, ZeropsServiceDeploys } from "../api.ts";
import type { ServiceRef } from "./types.ts";

export type ServiceDeploysClient = Pick<
  ZeropsApiClient,
  "readServiceDeploys" | "readServicesDeploys"
>;

export interface ServiceDeploysBatchOptions {
  /** How long a batch waits for the rest of its moment's askers. */
  readonly windowMs?: number;
  /** The most services one search names. */
  readonly chunk?: number;
}

interface Waiter {
  readonly serviceId: string;
  readonly resolve: (deploys: ZeropsServiceDeploys) => void;
  readonly reject: (cause: unknown) => void;
  settled: boolean;
  /** Told when this asker stops waiting: the batch it joined stops once nobody waits. */
  left: () => void;
}

const aborted = () => new DOMException("The read was abandoned.", "AbortError");

/** Reads what a service runs, batched per organization with every other service asked meanwhile. */
export function makeServiceDeploysBatch(
  client: ServiceDeploysClient,
  options: ServiceDeploysBatchOptions = {},
): (service: ServiceRef, signal: AbortSignal) => Promise<ZeropsServiceDeploys> {
  const windowMs = options.windowMs ?? 10;
  const chunk = options.chunk ?? 250;
  const pending = new Map<string, Waiter[]>();

  const flush = (organizationId: string): void => {
    const waiters = (pending.get(organizationId) ?? []).filter((waiter) => !waiter.settled);
    pending.delete(organizationId);
    if (waiters.length === 0) return;
    // The batch's reads stop once nobody waits for them any more.
    const controller = new AbortController();
    const byService = new Map<string, Waiter[]>();
    for (const waiter of waiters) {
      byService.set(waiter.serviceId, [...(byService.get(waiter.serviceId) ?? []), waiter]);
    }
    const settle = (
      serviceId: string,
      outcome: { ok: ZeropsServiceDeploys } | { error: unknown },
    ) => {
      for (const waiter of byService.get(serviceId) ?? []) {
        if (waiter.settled) continue;
        waiter.settled = true;
        if ("ok" in outcome) waiter.resolve(outcome.ok);
        else waiter.reject(outcome.error);
      }
      stopWhenAbandoned();
    };
    const stopWhenAbandoned = () => {
      if (waiters.every((waiter) => waiter.settled)) controller.abort();
    };
    for (const waiter of waiters) waiter.left = stopWhenAbandoned;
    const alone = (serviceId: string) =>
      client.readServiceDeploys(serviceId, controller.signal).then(
        (ok) => settle(serviceId, { ok }),
        (error: unknown) => settle(serviceId, { error }),
      );
    const ids = [...byService.keys()];
    if (ids.length === 1) {
      void alone(ids[0]!);
      return;
    }
    for (let start = 0; start < ids.length; start += chunk) {
      const part = ids.slice(start, start + chunk);
      void client.readServicesDeploys(organizationId, part, controller.signal).then(
        (answers) => {
          for (const serviceId of part) {
            const answer = answers.get(serviceId);
            if (answer === undefined) void alone(serviceId);
            else settle(serviceId, { ok: answer });
          }
        },
        (error: unknown) => {
          for (const serviceId of part) settle(serviceId, { error });
        },
      );
    }
  };

  return (service, signal) =>
    new Promise<ZeropsServiceDeploys>((resolve, reject) => {
      if (signal.aborted) {
        reject(aborted());
        return;
      }
      const organizationId = service.project.organization.organizationId;
      const waiter: Waiter = {
        serviceId: service.serviceId,
        resolve,
        reject,
        settled: false,
        left: () => undefined,
      };
      signal.addEventListener(
        "abort",
        () => {
          if (waiter.settled) return;
          waiter.settled = true;
          reject(aborted());
          waiter.left();
        },
        { once: true },
      );
      const waiting = pending.get(organizationId);
      if (waiting !== undefined) {
        waiting.push(waiter);
        return;
      }
      pending.set(organizationId, [waiter]);
      Effect.runFork(
        Effect.sleep(Duration.millis(windowMs)).pipe(
          Effect.andThen(Effect.sync(() => flush(organizationId))),
        ),
      );
    });
}
