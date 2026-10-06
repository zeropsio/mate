import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, serviceValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { servicesScope } from "../families/service.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { enableSubdomainAccessExecutor } from "./executors/serviceWrites.ts";

const ENABLE = {
  kind: "enable-subdomain-access",
  orgId: ORG,
  projectId: "p1",
  serviceId: "s1",
} as const;

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const published = (store: AccountStore) =>
  store.dispatch({
    kind: "rows",
    scope: servicesScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "service",
        id: "s1",
        value: serviceValue({ id: "s1", projectId: "p1", subdomainAccess: true }),
        revision: zeropsVersion(2),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<void>) {
  const calls: string[] = [];
  const submit = enableSubdomainAccessExecutor({
    enableSubdomainAccess: (serviceId) => {
      calls.push(serviceId);
      return answer();
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("enable-subdomain-access", () => {
  it.effect(
    "ends as Zerops answers it; a lost answer is adopted only once the service shows it",
    () =>
      Effect.gen(function* () {
        for (const [answer, publishedAfter, expected] of [
          [
            () => Promise.resolve(),
            false,
            { stage: "done", operationId: "s1", outcome: "succeeded" },
          ],
          [
            () => Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403)),
            false,
            { stage: "refused", reason: "Not allowed." },
          ],
          [
            () => Promise.reject(new ZeropsApiError("No answer.", "network")),
            false,
            { stage: "uncertain", next: "ask-owner-again" },
          ],
          [
            () => Promise.reject(new ZeropsApiError("No answer.", "network")),
            true,
            { stage: "done", operationId: "s1", outcome: "succeeded" },
          ],
        ] as const) {
          const store = account();
          const { operations, calls } = operationsOf(store, answer);
          yield* operations.submit(ENABLE);
          if (publishedAfter) {
            published(store);
            yield* operations.retry("r1");
          }
          expect(progressOf(store)).toEqual(expected);
          expect(calls).toEqual(["s1"]);
        }
      }),
  );
});
