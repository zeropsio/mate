import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  type ChiefRead,
  chiefRead,
  keepCosts,
  keepGroupBy,
  keepIdentity,
  keepSearch,
  pinGroupBy,
  pinSearch,
} from "./chiefProxy.ts";

describe("the Chief's proxy lets through only what zcp's org mode reads", () => {
  // `OrgReader` and its transport on zcp's `feat/mastermate-org`
  // (`internal/platform/org_reader.go`, the zerops-go SDK v1.0.20's paths): every read it makes.
  const allowed: ReadonlyArray<readonly [string, string, ChiefRead]> = [
    ["GET", "user/info", { kind: "identity" }],
    ["POST", "project/search", { kind: "search", of: "project" }],
    ["POST", "service-stack/search", { kind: "search", of: "service" }],
    ["POST", "process/search", { kind: "search", of: "process" }],
    ["POST", "app-version/search", { kind: "search", of: "appVersion" }],
    ["POST", "service-stack-type/search", { kind: "catalogue" }],
    ["GET", "service-stack/S1/env", { kind: "service", serviceId: "S1" }],
    ["GET", "project/P1/log", { kind: "project", projectId: "P1" }],
    ["GET", "project/P1/public-http-routing", { kind: "project", projectId: "P1" }],
    ["POST", "public-port-routing/search", { kind: "search", of: "portRouting" }],
    ["POST", "transaction-debit/cost-search", { kind: "costs" }],
    ["POST", "transaction-debit/group-by-search", { kind: "groupBy", of: "cost" }],
    ["POST", "stats-history/group-by-search", { kind: "groupBy", of: "usage" }],
    // HQ's own answer, no Zerops read: who the Chief acts for and what they may do.
    ["GET", "chief/person", { kind: "person" }],
  ];
  it.each(allowed)("%s %s is allowed", (method, path, read) => {
    expect(chiefRead(method, path)).toEqual(read);
  });

  it.each([
    // The SDK joins its own `/api/rest/public/…` onto the proxy's address: the same read.
    ["POST", "api/rest/public/project/search", { kind: "search", of: "project" }],
    ["GET", "/api/rest/public/project/P1/log", { kind: "project", projectId: "P1" }],
    ["POST", "//service-stack//search/", { kind: "search", of: "service" }],
  ] as const)("%s %s names the same read", (method, path, read) => {
    expect(chiefRead(method, path)).toEqual(read);
  });

  it.each([
    ["PUT", "project/P1"],
    ["DELETE", "service-stack/S1"],
    ["PATCH", "project/P1/env"],
    ["HEAD", "user/info"],
    ["POST", "project/P1/env"],
    ["POST", "service-stack/S1/restart"],
    ["POST", "user-data"],
    ["POST", "billing/client/ORG/payment"],
    ["POST", "transaction-debit/ORG"],
  ])("%s %s is refused as a method that writes", (method, path) => {
    expect(chiefRead(method, path)).toEqual({ refused: "method" });
  });

  it.each([
    ["GET", "project/P1"],
    ["GET", "service-stack/S1"],
    ["GET", "project/P1/env-file"],
    ["GET", "service-stack/S1/user-data"],
    ["GET", "process/X1"],
    ["GET", "client/ORG/user/list"],
    ["GET", "client/ORG/project"],
    ["POST", "user-data/search"],
    ["POST", "user-token/search"],
    ["POST", "client/search"],
    ["GET", "service-stack/S1/env/extra"],
    ["GET", "project/../client/ORG/user/list"],
    ["GET", "project/%2e%2e/log"],
    ["GET", ""],
    ["GET", "billing/client/ORG/status"],
    ["GET", "client/ORG/billing-info"],
    ["POST", "card-payment/search"],
    ["POST", "resource-consumption/group-by-search"],
  ])("%s %s is outside the allowlist", (method, path) => {
    expect(chiefRead(method, path)).toEqual({ refused: "path" });
  });
});

describe("a Chief's search is pinned to HQ's org", () => {
  const pinned = (body: unknown) => Option.getOrUndefined(pinSearch(body, "ORG"));

  it.each([
    [
      "a search naming no org",
      { search: [{ name: "projectId", operator: "eq", value: "P1" }], limit: 10 },
      {
        search: [
          { name: "projectId", operator: "eq", value: "P1" },
          { name: "clientId", operator: "eq", value: "ORG" },
        ],
        limit: 10,
      },
    ],
    [
      "a search naming another org",
      { search: [{ name: "clientId", operator: "eq", value: "ORG2" }] },
      { search: [{ name: "clientId", operator: "eq", value: "ORG" }] },
    ],
    [
      "a search with no terms",
      { sort: [{ name: "created", ascending: false }], offset: 1000 },
      {
        search: [{ name: "clientId", operator: "eq", value: "ORG" }],
        sort: [{ name: "created", ascending: false }],
        offset: 1000,
      },
    ],
    [
      "a search with a field the filter does not know",
      { search: [], searchOr: [{ name: "clientId", operator: "eq", value: "ORG2" }] },
      { search: [{ name: "clientId", operator: "eq", value: "ORG" }] },
    ],
  ])("%s", (_, body, expected) => {
    expect(pinned(body)).toEqual(expected);
  });

  it.each([
    ["not an object", "x"],
    ["terms not a list", { search: "clientId" }],
    ["null", null],
  ])("a body %s is no search", (_, body) => {
    expect(pinned(body)).toBeUndefined();
  });
});

describe("a Chief's search answers only projects its person reaches", () => {
  const reaches = (projectId: string) => projectId === "P_IN";

  it.each([
    [
      "project",
      {
        items: [
          { id: "P_IN", clientId: "ORG" },
          { id: "P_OUT", clientId: "ORG" },
          { id: "P_IN", clientId: "ORG2" },
        ],
        totalHits: 3,
      },
      { items: [{ id: "P_IN", clientId: "ORG" }], totalHits: 1 },
    ],
    [
      "service",
      {
        items: [
          { id: "S1", projectId: "P_IN", clientId: "ORG" },
          { id: "S2", projectId: "P_OUT", clientId: "ORG" },
        ],
        totalHits: 2,
      },
      { items: [{ id: "S1", projectId: "P_IN", clientId: "ORG" }], totalHits: 1 },
    ],
    [
      "process",
      {
        items: [
          { id: "X1", projectId: null, clientId: "ORG" },
          { id: "X2", projectId: "P_IN", clientId: "ORG" },
        ],
      },
      { items: [{ id: "X2", projectId: "P_IN", clientId: "ORG" }] },
    ],
  ] as const)("a %s search", (of, body, expected) => {
    expect(
      Option.getOrUndefined(
        keepSearch(body, { orgId: "ORG", of: of === "project" ? "project" : "service", reaches }),
      ),
    ).toEqual(expected);
  });

  it("an answer in a shape it does not know is none", () => {
    expect(Option.isNone(keepSearch({ list: [] }, { orgId: "ORG", of: "project", reaches }))).toBe(
      true,
    );
  });

  it("who the token is answers HQ's org alone", () => {
    expect(
      Option.getOrUndefined(
        keepIdentity(
          { id: "U", clientUserList: [{ clientId: "ORG" }, { clientId: "ORG2" }] },
          "ORG",
        ),
      ),
    ).toEqual({ id: "U", clientUserList: [{ clientId: "ORG" }] });
  });
});

describe("a Chief's grouped search is pinned to HQ's org and keeps its range", () => {
  it("keeps the range, the grouping and the terms, the org replaced by HQ's own", () => {
    expect(
      Option.getOrUndefined(
        pinGroupBy(
          {
            search: [{ name: "clientId", operator: "eq", value: "ORG2" }],
            from: "2026-10-01T00:00:00Z",
            till: "2026-10-14T00:00:00Z",
            timeZone: "UTC",
            groupBy: "projectId",
            timeGroupBy: "1d",
            subscriptionName: "elsewhere",
            receiverId: "R1",
          },
          "ORG",
        ),
      ),
    ).toEqual({
      search: [{ name: "clientId", operator: "eq", value: "ORG" }],
      from: "2026-10-01T00:00:00Z",
      till: "2026-10-14T00:00:00Z",
      timeZone: "UTC",
      groupBy: "projectId",
      timeGroupBy: "1d",
    });
  });

  it.each([
    ["no terms list", { search: "x", from: "a", till: "b" }],
    ["a range that is no text", { search: [], from: 1, till: "b" }],
  ])("a body with %s is no grouped search", (_, body) => {
    expect(Option.isNone(pinGroupBy(body, "ORG"))).toBe(true);
  });
});

describe("a Chief's grouped answer keeps only projects its person reaches", () => {
  const reaches = (projectId: string) => projectId === "P_IN";
  const body = {
    items: [
      { projectId: "P_IN", sumTotalPrice: 2 },
      { projectId: "P_OUT", sumTotalPrice: 5 },
      { projectId: null, sumTotalPrice: 1 },
    ],
    totalHits: 3,
  };

  it("drops every item of a project outside its reach, and one of no project", () => {
    expect(Option.getOrUndefined(keepGroupBy(body, { reaches, all: false }))).toEqual({
      items: [{ projectId: "P_IN", sumTotalPrice: 2 }],
      totalHits: 1,
    });
  });

  it("answers whole a person who sees the org's finances", () => {
    expect(Option.getOrUndefined(keepGroupBy(body, { reaches, all: true }))).toEqual(body);
  });
});

describe("a Chief's costs answer only what its person may see of them", () => {
  const reaches = (projectId: string) => projectId === "P_IN";
  const period = (thisMonth: number, today: number) => ({ thisMonth, today });
  const body = {
    client: { id: "ORG", periodCost: period(10, 1) },
    project: [
      { id: "P_IN", periodCost: period(3, 0.5) },
      { id: "P_OUT", periodCost: period(7, 0.5) },
    ],
    stack: [
      { id: "S_IN", periodCost: period(3, 0.5) },
      { id: "S_OUT", periodCost: period(7, 0.5) },
    ],
  };
  const serviceProject = new Map([
    ["S_IN", "P_IN"],
    ["S_OUT", "P_OUT"],
  ]);

  it("answers whole a person who sees the org's finances", () => {
    expect(Option.getOrUndefined(keepCosts(body, { reaches, all: true, serviceProject }))).toEqual(
      body,
    );
  });

  it("keeps another person to their projects, the org's total theirs alone", () => {
    expect(Option.getOrUndefined(keepCosts(body, { reaches, all: false, serviceProject }))).toEqual(
      {
        client: { id: "ORG", periodCost: period(3, 0.5) },
        project: [{ id: "P_IN", periodCost: period(3, 0.5) }],
        stack: [{ id: "S_IN", periodCost: period(3, 0.5) }],
      },
    );
  });

  it("an answer in a shape it does not know is none", () => {
    expect(Option.isNone(keepCosts({ items: [] }, { reaches, all: false, serviceProject }))).toBe(
      true,
    );
  });
});
