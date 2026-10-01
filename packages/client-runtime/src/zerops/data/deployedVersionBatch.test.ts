import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { ZeropsApiClient } from "../api.ts";
import { makeZeropsResourceRestAdapter } from "./resourceRestAdapter.ts";
import {
  AccountEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  type ServiceRef,
} from "./types.ts";

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};
const scope = { account, epoch: AccountEpoch.make(1) };
const serviceOf = (organizationId: string, id: string): ServiceRef => ({
  kind: "service",
  project: {
    kind: "project",
    organization: {
      kind: "organization",
      account,
      organizationId: ZeropsOrganizationId.make(organizationId),
    },
    projectId: ZeropsProjectId.make(`${organizationId}-project`),
  },
  serviceId: ZeropsServiceId.make(id),
});

/** The platform's services: each runs version `v-<id>`, deployed as `name-<id>`. */
const row = (id: string) => ({
  id,
  activeAppVersion: { id: `v-${id}`, status: "ACTIVE" },
  userData: [
    { key: "appVersionId", content: `v-${id}` },
    { key: "appVersionName", content: `name-${id}` },
  ],
});
const expectedOf = (id: string) => ({ activeId: `v-${id}`, source: "GIT", name: `name-${id}` });

interface Platform {
  readonly requests: Array<{ readonly method: string; readonly path: string }>;
  readonly client: ZeropsApiClient;
}

/** A Zerops whose searches leave out `unindexed` services, as a lagging index does. */
function platform(options: { readonly unindexed?: ReadonlyArray<string> } = {}): Platform {
  const requests: Platform["requests"] = [];
  const unindexed = new Set(options.unindexed);
  const client = new ZeropsApiClient({
    baseUrl: account.apiOrigin,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/rest/public", "");
      const method = init?.method ?? "GET";
      requests.push({ method, path });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (method === "GET" && path.startsWith("/service-stack/")) {
        const id = path.slice("/service-stack/".length);
        return json({ ...row(id), activeAppVersion: { id: `v-${id}`, source: "GIT" } });
      }
      const ids = (
        JSON.parse(String(init?.body)) as {
          readonly search: ReadonlyArray<{ readonly name: string; readonly value: unknown }>;
        }
      ).search.find(({ name }) => name === "id")?.value as ReadonlyArray<string>;
      if (path === "/service-stack/search")
        return json({ items: ids.filter((id) => !unindexed.has(id)).map(row) });
      if (path === "/app-version/search")
        return json({ items: ids.map((id) => ({ id, source: "GIT", status: "ACTIVE" })) });
      return new Response("{}", { status: 404 });
    },
  });
  client.restoreSession({ accessToken: "account-token" });
  return { requests, client };
}

const readAll = (client: ZeropsApiClient, services: ReadonlyArray<ServiceRef>) => {
  const adapter = makeZeropsResourceRestAdapter(client);
  return Effect.all(
    services.map((service) =>
      adapter.readServiceDeployedVersion(
        { kind: "service-deployed-version", account: scope, service },
        { abortSignal: new AbortController().signal },
      ),
    ),
    { concurrency: "unbounded" },
  );
};

const ids = (count: number) => Array.from({ length: count }, (_, index) => `s${index}`);

describe("what services run, read together (A14)", () => {
  it.effect.each([2, 30, 120])(
    "%i services asked for at once cost two searches, whatever their count",
    (count) =>
      Effect.gen(function* () {
        const { client, requests } = platform();
        const values = yield* readAll(
          client,
          ids(count).map((id) => serviceOf("org", id)),
        );

        expect(values).toEqual(ids(count).map(expectedOf));
        expect(requests).toEqual([
          { method: "POST", path: "/service-stack/search" },
          { method: "POST", path: "/app-version/search" },
        ]);
      }),
  );

  it.effect("one service asked for alone is read on its own, lag-free", () =>
    Effect.gen(function* () {
      const { client, requests } = platform();
      const values = yield* readAll(client, [serviceOf("org", "s0")]);

      expect(values).toEqual([expectedOf("s0")]);
      expect(requests).toEqual([{ method: "GET", path: "/service-stack/s0" }]);
    }),
  );

  it.effect("a service the search does not carry yet is read on its own", () =>
    Effect.gen(function* () {
      const { client, requests } = platform({ unindexed: ["s1"] });
      const values = yield* readAll(
        client,
        ids(3).map((id) => serviceOf("org", id)),
      );

      expect(values).toEqual(ids(3).map(expectedOf));
      expect(requests).toEqual([
        { method: "POST", path: "/service-stack/search" },
        { method: "POST", path: "/app-version/search" },
        { method: "GET", path: "/service-stack/s1" },
      ]);
    }),
  );

  it.effect("each organization's services are searched in that organization", () =>
    Effect.gen(function* () {
      const { client, requests } = platform();
      yield* readAll(client, [
        serviceOf("one", "a"),
        serviceOf("one", "b"),
        serviceOf("two", "c"),
        serviceOf("two", "d"),
      ]);

      expect(requests.filter(({ path }) => path === "/service-stack/search")).toHaveLength(2);
    }),
  );

  it.effect("a reader that stops waiting leaves the others' answers standing", () =>
    Effect.gen(function* () {
      const { client } = platform();
      const adapter = makeZeropsResourceRestAdapter(client);
      const read = (id: string, signal: AbortSignal) =>
        adapter.readServiceDeployedVersion(
          { kind: "service-deployed-version", account: scope, service: serviceOf("org", id) },
          { abortSignal: signal },
        );
      const leaving = new AbortController();
      const left = yield* Effect.forkChild(Effect.result(read("s0", leaving.signal)));
      const staying = yield* Effect.forkChild(read("s1", new AbortController().signal));
      leaving.abort();

      expect((yield* Fiber.join(left))._tag).toBe("Failure");
      expect(yield* Fiber.join(staying)).toEqual(expectedOf("s1"));
    }),
  );
});
