import type {
  EnvironmentId,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useZeropsDataCatalogStore } from "./dataCatalog";

const environmentId = "env-1" as EnvironmentId;

const service = (hostname: string, browsable = true) => ({
  hostname,
  type: "postgresql@16",
  family: "sql",
  support: "full",
  actions: browsable ? [{ id: "readTable", enabled: true, readOnly: true, reason: "" }] : [],
  status: "running",
});

const node = (
  serviceName: string,
  segments: ReadonlyArray<string>,
  kind: "container" | "tabular",
) => ({
  name: segments[segments.length - 1] ?? serviceName,
  kind,
  path: { service: serviceName, segments },
  hasChildren: kind === "container",
});

function callerFor(
  responses: (request: ZeropsDataConsoleRequest) => ZeropsDataConsoleResponse | undefined,
) {
  const requests: ZeropsDataConsoleRequest[] = [];
  return {
    requests,
    call: (request: ZeropsDataConsoleRequest) => {
      requests.push(request);
      return Promise.resolve(responses(request));
    },
  };
}

const twoLevelCaller = () =>
  callerFor((request) => {
    if (request.kind === "refresh") {
      return {
        kind: "services",
        project: { id: "p", name: "p" },
        services: [service("db"), service("cache", false)],
        allowWrites: false,
      } as ZeropsDataConsoleResponse;
    }
    if (request.kind === "tree" && request.path.segments.length === 0) {
      return {
        kind: "tree",
        nodes: [node("db", ["public"], "container")],
        nextCursor: "",
      } as ZeropsDataConsoleResponse;
    }
    if (request.kind === "tree") {
      return {
        kind: "tree",
        nodes: [node("db", ["public", "orders"], "tabular")],
        nextCursor: "",
      } as ZeropsDataConsoleResponse;
    }
    return undefined;
  });

describe("useZeropsDataCatalogStore", () => {
  beforeEach(() => {
    useZeropsDataCatalogStore.setState({ byEnvironment: {} });
  });

  it("discovers with a refresh, so a service created after the console started is offered", async () => {
    const caller = twoLevelCaller();
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    expect(caller.requests[0]).toEqual({ kind: "refresh" });
  });

  it("walks browsable services down through their containers and lists their tables", async () => {
    const caller = twoLevelCaller();
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    const entry = useZeropsDataCatalogStore.getState().byEnvironment[environmentId];
    expect(entry?.status).toBe("ready");
    expect(entry?.entries.map((mention) => mention.token)).toEqual(["db", "db.orders"]);
    expect(caller.requests.filter((request) => request.kind === "tree").length).toBe(2);
  });

  it("loads once per environment and never re-requests for the session", async () => {
    const caller = twoLevelCaller();
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    expect(caller.requests.filter((request) => request.kind === "refresh").length).toBe(1);
  });

  it("fails without throwing when discovery answers nothing", async () => {
    const caller = callerFor(() => undefined);
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    const entry = useZeropsDataCatalogStore.getState().byEnvironment[environmentId];
    expect(entry?.status).toBe("failed");
    expect(entry?.entries).toEqual([]);
  });

  it("fails without throwing when a request rejects", async () => {
    await useZeropsDataCatalogStore
      .getState()
      .load(environmentId, () => Promise.reject(new Error("gone")));

    expect(useZeropsDataCatalogStore.getState().byEnvironment[environmentId]?.status).toBe(
      "failed",
    );
  });

  it("keeps a service whose tree fails, with the tables it did read", async () => {
    const caller = callerFor((request) =>
      request.kind === "refresh"
        ? ({
            kind: "services",
            project: { id: "p", name: "p" },
            services: [service("db")],
            allowWrites: false,
          } as ZeropsDataConsoleResponse)
        : undefined,
    );
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    const entry = useZeropsDataCatalogStore.getState().byEnvironment[environmentId];
    expect(entry?.status).toBe("ready");
    expect(entry?.entries.map((mention) => mention.token)).toEqual(["db"]);
  });

  it("drops a lone schema from the mention token and keeps the full path as an alias", async () => {
    const caller = callerFor((request) => {
      if (request.kind === "refresh") {
        return {
          kind: "services",
          project: { id: "p", name: "p" },
          services: [service("db")],
          allowWrites: false,
        } as ZeropsDataConsoleResponse;
      }
      if (request.kind === "tree" && request.path.segments.length === 0) {
        return {
          kind: "tree",
          nodes: [node("db", ["public"], "container")],
          nextCursor: "",
        } as ZeropsDataConsoleResponse;
      }
      if (request.kind === "tree") {
        return {
          kind: "tree",
          nodes: [node("db", ["public", "orders"], "tabular")],
          nextCursor: "",
        } as ZeropsDataConsoleResponse;
      }
      return undefined;
    });
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    const entries = useZeropsDataCatalogStore.getState().byEnvironment[environmentId]?.entries;
    expect(entries?.map((entry) => entry.token)).toEqual(["db", "db.orders"]);
    expect(entries?.[1]?.aliases).toEqual(["db.public.orders"]);
  });

  it("keeps both schemas in the token when a service has two", async () => {
    const caller = callerFor((request) => {
      if (request.kind === "refresh") {
        return {
          kind: "services",
          project: { id: "p", name: "p" },
          services: [service("db")],
          allowWrites: false,
        } as ZeropsDataConsoleResponse;
      }
      if (request.kind === "tree" && request.path.segments.length === 0) {
        return {
          kind: "tree",
          nodes: [node("db", ["public"], "container"), node("db", ["billing"], "container")],
          nextCursor: "",
        } as ZeropsDataConsoleResponse;
      }
      if (request.kind === "tree") {
        return {
          kind: "tree",
          nodes: [node("db", [...request.path.segments, "orders"], "tabular")],
          nextCursor: "",
        } as ZeropsDataConsoleResponse;
      }
      return undefined;
    });
    await useZeropsDataCatalogStore.getState().load(environmentId, caller.call);

    expect(
      useZeropsDataCatalogStore
        .getState()
        .byEnvironment[environmentId]?.entries.map((entry) => entry.token),
    ).toEqual(["db", "db.public.orders", "db.billing.orders"]);
  });
});
