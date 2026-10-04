import type { ZeropsTopologyGroup } from "@t3tools/client-runtime/zerops/topology";
import { describe, expect, it } from "vite-plus/test";

import {
  groupAddressEnvironments,
  mateAddresses,
  type MateAddressInput,
} from "./mateAddresses.logic";

const svc = (
  hostname: string,
  urls: ReadonlyArray<string>,
  group: ZeropsTopologyGroup = "runtimes",
) => ({
  hostname,
  group,
  routes: urls.map((url) => ({ url })),
});

const route = (service: string, url: string) => ({ service, url });

const brief = (input: MateAddressInput) =>
  mateAddresses(input).map(({ service, role, url }) => ({ service, role, url }));

describe("mateAddresses", () => {
  /**
   * The owner: "the browser automatically opens all tabs, imo it shouldnt" —
   * the addresses are a list a person picks from, each with what it is to
   * them: the dev they work on, the stage they check, the production people use.
   */
  it.each<{ name: string; input: MateAddressInput; expected: ReturnType<typeof brief> }>([
    {
      name: "a dev/stage pair reads as dev and stage, dev first",
      input: {
        services: [
          svc("appstage", ["https://appstage-1-3000.example.app"]),
          svc("db", [], "data"),
          svc("appdev", ["https://appdev-1-3000.example.app"]),
        ],
      },
      expected: [
        { service: "appdev", role: "dev", url: "https://appdev-1-3000.example.app" },
        { service: "appstage", role: "stage", url: "https://appstage-1-3000.example.app" },
      ],
    },
    {
      name: "a pair grown out of one service pairs `app` with `appstage`",
      input: {
        services: [
          svc("app", ["https://app-1-3000.example.app"]),
          svc("appstage", ["https://appstage-1-3000.example.app"]),
        ],
      },
      expected: [
        { service: "app", role: "dev", url: "https://app-1-3000.example.app" },
        { service: "appstage", role: "stage", url: "https://appstage-1-3000.example.app" },
      ],
    },
    {
      name: "a service outside a pair keeps no role and comes after the roles",
      input: {
        services: [
          svc("docs", ["https://docs-1-80.example.app"]),
          svc("webdev", ["https://webdev-1-3000.example.app"]),
          svc("webstage", ["https://webstage-1-3000.example.app"]),
        ],
      },
      expected: [
        { service: "webdev", role: "dev", url: "https://webdev-1-3000.example.app" },
        { service: "webstage", role: "stage", url: "https://webstage-1-3000.example.app" },
        { service: "docs", role: undefined, url: "https://docs-1-80.example.app" },
      ],
    },
    {
      name: "a `{name}dev` alone is the dev before its stage exists",
      input: { services: [svc("matedev", ["https://matedev-1-3000.example.app"])] },
      expected: [{ service: "matedev", role: "dev", url: "https://matedev-1-3000.example.app" }],
    },
    {
      name: "a service's first route is its address, not one per port",
      input: {
        services: [
          svc("app", ["https://app-1-3000.example.app", "https://app-1-8080.example.app"]),
        ],
      },
      expected: [{ service: "app", role: undefined, url: "https://app-1-3000.example.app" }],
    },
    {
      name: "the control plane serves Mate itself and is left out",
      input: {
        services: [
          svc("app", ["https://app-1-3000.example.app"]),
          svc("zcp", ["https://zcp-1-8080.example.app"], "infrastructure"),
        ],
      },
      expected: [{ service: "app", role: undefined, url: "https://app-1-3000.example.app" }],
    },
    {
      name: "anything that is not a browsable url is left out",
      input: { services: [svc("worker", ["ftp://nope"]), svc("db", [])] },
      expected: [],
    },
    {
      name: "the group's stage and production projects follow the Mate's own",
      input: {
        services: [svc("appdev", ["https://appdev-1-3000.example.app"])],
        environments: [
          { role: "prod", routes: [route("app", "https://shop.example.com")] },
          { role: "stage", routes: [route("web", "https://web-2-80.example.app")] },
        ],
      },
      expected: [
        { service: "appdev", role: "dev", url: "https://appdev-1-3000.example.app" },
        { service: "web", role: "stage", url: "https://web-2-80.example.app" },
        { service: "app", role: "production", url: "https://shop.example.com" },
      ],
    },
    {
      name: "a production service named like one of the Mate's own keeps its own tab",
      input: {
        services: [
          svc("app", ["https://app-1-3000.example.app"]),
          svc("appstage", ["https://appstage-1-3000.example.app"]),
        ],
        environments: [{ role: "prod", routes: [route("app", "https://shop.example.com")] }],
      },
      expected: [
        { service: "app", role: "dev", url: "https://app-1-3000.example.app" },
        { service: "appstage", role: "stage", url: "https://appstage-1-3000.example.app" },
        { service: "app production", role: "production", url: "https://shop.example.com" },
      ],
    },
    {
      name: "one address is listed once, whoever names it",
      input: {
        services: [svc("app", ["https://app-1-3000.example.app"])],
        environments: [{ role: "prod", routes: [route("app", "https://app-1-3000.example.app")] }],
      },
      expected: [{ service: "app", role: undefined, url: "https://app-1-3000.example.app" }],
    },
  ])("$name", ({ input, expected }) => {
    expect(brief(input)).toEqual(expected);
  });

  it("carries the address without its scheme, what a row shows", () => {
    expect(mateAddresses({ services: [svc("app", ["https://app-1-3000.example.app/"])] })).toEqual([
      {
        service: "app",
        role: undefined,
        url: "https://app-1-3000.example.app/",
        host: "app-1-3000.example.app",
      },
    ]);
  });
});

describe("groupAddressEnvironments", () => {
  const project = (id: string, tagList: ReadonlyArray<string>) => ({ id, tagList });
  const routes: Record<string, ReadonlyArray<{ service: string; url: string }>> = {
    mate: [route("appdev", "https://appdev-1-3000.example.app")],
    stage: [route("app", "https://app-2-80.example.app")],
    prod: [route("app", "https://app-3-80.example.app")],
    other: [route("app", "https://app-4-80.example.app")],
  };

  it.each([
    {
      name: "the Mate's group's stage and production, never another group's or a Mate's dev",
      projects: [
        project("mate", ["mate:g:one", "mate:role:dev"]),
        project("stage", ["mate:g:one", "mate:role:stage"]),
        project("prod", ["mate:g:one", "mate:role:prod"]),
        project("peer", ["mate:g:one", "mate:role:dev"]),
        project("other", ["mate:g:two", "mate:role:prod"]),
      ],
      expected: [
        { role: "stage", routes: routes.stage },
        { role: "prod", routes: routes.prod },
      ],
    },
    {
      name: "nothing for a Mate in no group",
      projects: [project("mate", []), project("prod", ["mate:g:one", "mate:role:prod"])],
      expected: [],
    },
    {
      name: "nothing while the account does not hold the Mate's project",
      projects: [project("prod", ["mate:g:one", "mate:role:prod"])],
      expected: [],
    },
  ])("$name", ({ projects, expected }) => {
    expect(
      groupAddressEnvironments({
        projectId: "mate",
        projects,
        routesOf: (entry) => routes[entry.id],
      }),
    ).toEqual(expected);
  });

  it("leaves out a project whose services are not read yet", () => {
    expect(
      groupAddressEnvironments({
        projectId: "mate",
        projects: [
          project("mate", ["mate:g:one"]),
          project("prod", ["mate:g:one", "mate:role:prod"]),
        ],
        routesOf: () => undefined,
      }),
    ).toEqual([]);
  });
});
