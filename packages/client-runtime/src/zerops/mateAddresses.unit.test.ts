import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import { expect, it } from "vite-plus/test";

import { groupAddressEnvironments, mateAddresses, type MateAddressInput } from "./mateAddresses.ts";
import type { ZeropsTopologyGroup } from "./topology.ts";

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

const env = (
  role: "stage" | "prod",
  routes: ReadonlyArray<{ service: string; url: string }>,
  projectId: string = role,
) => ({ projectId, name: `${projectId} project`, role, routes });

const brief = (input: MateAddressInput) =>
  mateAddresses(input).map(({ service, role, url }) => ({ service, role, url }));

const devServer = (name: string, port: number, status = "running") => ({
  name,
  port,
  status,
  url: `https://appdev-1df2-${String(port)}.prg1.zerops.app`,
});
const named = (input: MateAddressInput) =>
  mateAddresses(input).map(({ role, name, url }) => ({ role, name, url }));

const project = (id: string, place?: { readonly app: string; readonly kind: RoleProjectKind }) => ({
  id,
  name: `${id} project`,
  ...(place === undefined
    ? {}
    : {
        hq: {
          appId: place.app,
          appName: `${place.app} app`,
          kind: place.kind,
          mate: null,
        },
      }),
});
const routes: Record<string, ReadonlyArray<{ service: string; url: string }>> = {
  mate: [route("appdev", "https://appdev-1-3000.example.app")],
  stage: [route("app", "https://app-2-80.example.app")],
  prod: [route("app", "https://app-3-80.example.app")],
  other: [route("app", "https://app-4-80.example.app")],
};

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | (left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role), → (left, right) => ROLE_ORDER.indexOf(right.role) - ROLE_ORDER.indexOf(left.role),
it("ZV31: A Mate's addresses list its dev first, then its preview, the stage and the production, and addresses with no role last", () => {
  expect(
    brief({
      services: [svc("appdev", ["https://appdev-1-3000.example.app"])],
      environments: [
        env("prod", [route("app", "https://shop.example.com")]),
        env("stage", [route("web", "https://web-2-80.example.app")]),
      ],
    }),
  ).toEqual([
    { service: "appdev", role: "dev", url: "https://appdev-1-3000.example.app" },
    { service: "web stage", role: "stage", url: "https://web-2-80.example.app" },
    { service: "app production", role: "production", url: "https://shop.example.com" },
  ]);
  expect(
    brief({
      services: [
        svc("docs", ["https://docs-1-80.example.app"]),
        svc("webdev", ["https://webdev-1-3000.example.app"]),
        svc("webstage", ["https://webstage-1-3000.example.app"]),
      ],
    }),
  ).toEqual([
    { service: "webdev", role: "dev", url: "https://webdev-1-3000.example.app" },
    { service: "webstage", role: "preview", url: "https://webstage-1-3000.example.app" },
    { service: "docs", role: undefined, url: "https://docs-1-80.example.app" },
  ]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | add(part.preview.service, projectRole ?? "preview", part.preview.url); → add(part.preview.service, "preview", part.preview.url);
it("ZV32: A Mate's paired half is its preview, except in a project that is itself the stage or the production, where it takes that role", () => {
  expect(
    brief({
      services: [
        svc("appstage", ["https://appstage-1-3000.example.app"]),
        svc("appdev", ["https://appdev-1-3000.example.app"]),
      ],
      ownRole: "stage",
    }),
  ).toEqual([
    { service: "appdev", role: "dev", url: "https://appdev-1-3000.example.app" },
    { service: "appstage", role: "stage", url: "https://appstage-1-3000.example.app" },
  ]);
  expect(
    brief({
      services: [
        svc("appstage", ["https://appstage-1-3000.example.app"]),
        svc("db", [], "data"),
        svc("appdev", ["https://appdev-1-3000.example.app"]),
      ],
    }),
  ).toEqual([
    { service: "appdev", role: "dev", url: "https://appdev-1-3000.example.app" },
    { service: "appstage", role: "preview", url: "https://appstage-1-3000.example.app" },
  ]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | if (listed.has(other.service)) continue; → if (listed.has(`${other.service} `)) continue;
it("ZV33: A service's address is its first route: another port of the same service is not another address", () => {
  expect(
    brief({
      services: [svc("app", ["https://app-1-3000.example.app", "https://app-1-8080.example.app"])],
    }),
  ).toEqual([{ service: "app", role: undefined, url: "https://app-1-3000.example.app" }]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | const suffix = ofRole.length === 1 ? role : environment.name; → const suffix = role;
it("ZV34: Two stage or production projects of one application keep their sites apart by their project's name; a single one's sites are keyed by their role", () => {
  expect(
    brief({
      services: [svc("app", ["https://app-1-3000.example.app"])],
      environments: [
        env("stage", [route("app", "https://app-2-80.example.app")], "eu"),
        env("stage", [route("app", "https://app-3-80.example.app")], "us"),
      ],
    }),
  ).toEqual([
    { service: "app eu project", role: "stage", url: "https://app-2-80.example.app" },
    { service: "app us project", role: "stage", url: "https://app-3-80.example.app" },
    { service: "app", role: undefined, url: "https://app-1-3000.example.app" },
  ]);
  expect(
    brief({
      services: [svc("matedev", ["https://matedev-1-3000.example.app"])],
      environments: [env("stage", [route("app", "https://app-2-80.example.app")])],
    }),
  ).toEqual([
    { service: "matedev", role: "dev", url: "https://matedev-1-3000.example.app" },
    { service: "app stage", role: "stage", url: "https://app-2-80.example.app" },
  ]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | if (!isBrowsableUrl(url) || seenUrls.has(url)) return; → if (!isBrowsableUrl(url)) return;
it("ZV35: One address is listed once, whoever names it", () => {
  expect(
    brief({
      services: [svc("app", ["https://app-1-3000.example.app"])],
      environments: [env("prod", [route("app", "https://app-1-3000.example.app")])],
    }),
  ).toEqual([{ service: "app", role: undefined, url: "https://app-1-3000.example.app" }]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | return running.length > 1 ? running : []; → return running.length > 0 ? running : [];
it("ZV36: A dev entry running several dev servers lists each running one as its own dev address, by the server's own name or its port where it has none; one dev server names nothing", () => {
  expect(
    named({
      services: [
        {
          ...svc("appdev", ["https://appdev-1df2-3000.prg1.zerops.app"]),
          devServers: [devServer("web", 3000)],
        },
      ],
    }),
  ).toEqual([{ role: "dev", name: "appdev", url: "https://appdev-1df2-3000.prg1.zerops.app" }]);
  expect(
    named({
      services: [
        {
          ...svc("appdev", ["https://appdev-1df2-3000.prg1.zerops.app"]),
          devServers: [
            devServer("web", 3000),
            devServer("", 8080),
            devServer("worker", 9000, "stopped"),
          ],
        },
      ],
    }),
  ).toEqual([
    { role: "dev", name: "appdev · web", url: "https://appdev-1df2-3000.prg1.zerops.app" },
    { role: "dev", name: "appdev · :8080", url: "https://appdev-1df2-8080.prg1.zerops.app" },
  ]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, ""); → const hostOf = (url: string) => url.replace(/^https?:\/\//u, "");
it("ZV37: Every address carries itself without its scheme or trailing slash, as a row shows it", () => {
  expect(
    mateAddresses({ services: [svc("app", ["https://app-1-3000.example.app/"])] }).map(
      (address) => address.host,
    ),
  ).toEqual(["app-1-3000.example.app"]);
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | if (project.hq?.appId !== appId || role === undefined) return []; → if (role === undefined) return [];
it("ZV38: A Mate's addresses reach only its own application's stage and production projects, never another application's or another Mate's dev", () => {
  expect(
    groupAddressEnvironments({
      projectId: "mate",
      projects: [
        project("mate", { app: "one", kind: "mate" }),
        project("stage", { app: "one", kind: "stage" }),
        project("prod", { app: "one", kind: "production" }),
        project("peer", { app: "one", kind: "mate" }),
        project("other", { app: "two", kind: "production" }),
      ],
      routesOf: (entry) => routes[entry.id],
    }),
  ).toEqual({
    ownRole: undefined,
    environments: [
      { projectId: "stage", name: "stage project", role: "stage", routes: routes.stage },
      { projectId: "prod", name: "prod project", role: "prod", routes: routes.prod },
    ],
    pending: false,
  });
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | if (own === undefined) return { ownRole: undefined, environments: [], pending: true }; → if (own === undefined) return { ownRole: undefined, environments: [], pending: false };
it("ZV39: While the account does not hold the Mate's own project, its addresses wait and name no environment", () => {
  expect(
    groupAddressEnvironments({
      projectId: "mate",
      projects: [project("prod", { app: "one", kind: "production" })],
      routesOf: (entry) => routes[entry.id],
    }),
  ).toEqual({ ownRole: undefined, environments: [], pending: true });
});

// witness: packages/client-runtime/src/zerops/mateAddresses.ts | pending = true; → pending = false;
it("ZV40: A stage or production project whose services are not read yet is left out, and the addresses are said to wait", () => {
  expect(
    groupAddressEnvironments({
      projectId: "mate",
      projects: [
        project("mate", { app: "one", kind: "mate" }),
        project("prod", { app: "one", kind: "production" }),
      ],
      routesOf: () => undefined,
    }),
  ).toEqual({ ownRole: undefined, environments: [], pending: true });
});
