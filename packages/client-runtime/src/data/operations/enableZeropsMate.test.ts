import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, serviceValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { servicesScope } from "../families/service.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { enableZeropsMateExecutor } from "./executors/serviceWrites.ts";

const ENABLE = {
  kind: "enable-zerops-mate",
  orgId: ORG,
  projectId: "p1",
  serviceId: "s1",
} as const;

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const flagged = (store: AccountStore, content: string) =>
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
        value: serviceValue({
          id: "s1",
          projectId: "p1",
          userData: [{ key: "ZCP_MATE_ENABLED", content }],
        }),
        revision: zeropsVersion(2),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<void>) {
  const calls: string[] = [];
  const submit = enableZeropsMateExecutor({
    enableZeropsMate: (serviceId) => {
      calls.push(serviceId);
      return answer();
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("enable-zerops-mate", () => {
  it.effect("ends as Zerops answers it; a lost answer is adopted only once the flag reads on", () =>
    Effect.gen(function* () {
      for (const [answer, flagAfter, expected] of [
        [() => Promise.resolve(), null, { stage: "done", operationId: "s1", outcome: "succeeded" }],
        [
          () => Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403)),
          null,
          { stage: "refused", reason: "Not allowed." },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          "0",
          { stage: "uncertain", next: "ask-owner-again" },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          " True ",
          { stage: "done", operationId: "s1", outcome: "succeeded" },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, answer);
        yield* operations.submit(ENABLE);
        if (flagAfter !== null) {
          flagged(store, flagAfter);
          yield* operations.retry("r1");
        }
        expect(progressOf(store)).toEqual(expected);
        expect(calls).toEqual(["s1"]);
      }
    }),
  );
});
