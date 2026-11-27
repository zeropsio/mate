import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsApiError } from "../../zerops/errors.ts";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import { servicesScope } from "../families/service.ts";
import type { AccountStore } from "../store.ts";
import { cancelBuildExecutor } from "./executors/pipelineWrites.ts";
import { deleteServiceExecutor, enableSubdomainAccessExecutor } from "./executors/serviceWrites.ts";

const lost = () => new ZeropsApiError("No answer.", "network");

const processRow = (
  store: AccountStore,
  id: string,
  serviceId: string,
  actionName: string,
  status: string,
  version: number,
) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: processValue({
          id,
          projectId: "p1",
          status,
          actionName,
          serviceStackIds: [serviceId],
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

const serviceRow = (store: AccountStore, id: string, subdomainAccess: boolean, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: servicesScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "service",
        id,
        value: { id, projectId: "p1", name: id, status: "ACTIVE", subdomainAccess },
        revision: zeropsVersion(version),
      },
    ],
  });

// witness: packages/client-runtime/src/data/operations/deleteService.ts | process.serviceStackIds.includes(intent.serviceId) → process.serviceStackIds.includes(intent.projectId)
it.effect(
  "OP+1: After a lost answer a service deletion adopts only a deletion running for that service",
  () =>
    Effect.gen(function* () {
      const store = accountOf(
        liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }),
      );
      const operations = zeropsOperations(
        store,
        deleteServiceExecutor({
          deleteService: async () => {
            throw lost();
          },
        }),
      );
      yield* operations.submit({
        kind: "delete-service",
        orgId: ORG,
        projectId: "p1",
        serviceId: "s1",
      });
      processRow(store, "other", "s2", "stack.delete", "RUNNING", 1);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "own", "s1", "stack.delete", "RUNNING", 1);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "own" });
    }),
);

// witness: packages/client-runtime/src/data/operations/cancelBuild.ts | new Set(["CANCELING", "CANCELED"]) → new Set(["CANCELED"])
it.effect(
  "OP+2: After a lost answer a canceled build is adopted only when its own process says it is canceling",
  () =>
    Effect.gen(function* () {
      const store = accountOf(
        liveZerops({ running: [{ id: "build", projectId: "p1", status: "RUNNING" }] }),
      );
      const operations = zeropsOperations(
        store,
        cancelBuildExecutor({
          cancelBuild: async () => {
            throw lost();
          },
        }),
      );
      yield* operations.submit({
        kind: "cancel-build",
        orgId: ORG,
        projectId: "p1",
        appVersionId: "version",
        processId: "build",
      });
      processRow(store, "other", "s2", "build", "CANCELING", 1);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "build", "s1", "build", "CANCELING", 2);
      yield* operations.retry("r1");
      expect(progressOf(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
);

// witness: packages/client-runtime/src/data/operations/enableSubdomainAccess.ts | service.value.subdomainAccess === true → service.value.subdomainAccess === false
it.effect(
  "OP+3: After a lost answer opening a subdomain is adopted only when that service is open",
  () =>
    Effect.gen(function* () {
      const store = accountOf(
        liveZerops({
          running: [],
          services: [
            { id: "s1", projectId: "p1", subdomainAccess: false },
            { id: "s2", projectId: "p1", subdomainAccess: false },
          ],
        }),
      );
      const operations = zeropsOperations(
        store,
        enableSubdomainAccessExecutor({
          enableSubdomainAccess: async () => {
            throw lost();
          },
        }),
      );
      yield* operations.submit({
        kind: "enable-subdomain-access",
        orgId: ORG,
        projectId: "p1",
        serviceId: "s1",
      });
      serviceRow(store, "s2", true, 2);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      serviceRow(store, "s1", true, 2);
      yield* operations.retry("r1");
      expect(progressOf(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
);
