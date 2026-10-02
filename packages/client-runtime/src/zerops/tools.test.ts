import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import { deriveGiteaState, partitionZeropsToolProjects, readZeropsToolKind } from "./tools.ts";

/** The probe project as the platform actually returned it, 2026-09-05. */
const GITEA_PROJECT: ZeropsProject = {
  id: "VX2ruYMlTGOrTBfVBmS45Q",
  name: "mate-gitea",
  status: "ACTIVE",
  publicZone: "s7cg2lbb37ebf9fao4ts4408bp0.prg1-zerops.zone",
  zeropsSubdomainHost: "926",
  tagList: ["mate:tool:gitea"],
};

function service(name: string, status: string, extra: Partial<ZeropsService> = {}): ZeropsService {
  return { id: name, name, status, isSystem: false, ...extra };
}

/** The `web` service as measured: subdomain access on, ports 2222/tcp and 3000/http. */
const WEB_ACTIVE = service("web", "ACTIVE", {
  subdomainAccess: true,
  ports: [
    { port: 2222, protocol: "tcp", scheme: "tcp" },
    { port: 3000, protocol: "tcp", scheme: "http" },
  ],
});

const RECIPE_SERVICES = [
  service("db", "ACTIVE"),
  service("volume", "ACTIVE"),
  WEB_ACTIVE,
  service("broker", "ACTIVE"),
];

describe("tool tags", () => {
  it.each([
    { name: "reads a known kind", tagList: ["mate:tool:gitea"], expected: "gitea" },
    { name: "ignores an unknown kind", tagList: ["mate:tool:jenkins"], expected: undefined },
    { name: "ignores a Mate's project", tagList: ["mate"], expected: undefined },
    { name: "ignores no tags at all", tagList: undefined, expected: undefined },
  ])("$name", ({ tagList, expected }) => {
    expect(readZeropsToolKind(tagList)).toBe(expected);
  });
});

describe("partitionZeropsToolProjects", () => {
  it("takes tools out of the list the group tree is built from", () => {
    const app: ZeropsProject = { id: "a", name: "crm", status: "ACTIVE", tagList: ["mate"] };
    const plain: ZeropsProject = { id: "b", name: "plain", status: "ACTIVE" };

    const { tools, rest } = partitionZeropsToolProjects([app, GITEA_PROJECT, plain]);

    expect(tools.map((tool) => tool.kind)).toEqual(["gitea"]);
    expect(rest.map((project) => project.name)).toEqual(["crm", "plain"]);
  });

  it("treats a tool HQ also places in a group as a tool — the two are disjoint", () => {
    const confused: ZeropsProject = {
      id: "c",
      name: "confused",
      status: "ACTIVE",
      tagList: ["mate:tool:gitea"],
      hq: { appId: "aaa", appName: "Acme", kind: "mate", mate: null },
    };

    const { tools, rest } = partitionZeropsToolProjects([confused]);

    expect(tools).toHaveLength(1);
    expect(rest).toEqual([]);
  });
});

describe("deriveGiteaState", () => {
  it("builds the public URL that actually resolves", () => {
    // Measured: this host answers 200; the recipe's own `app-prg1` spelling
    // does not resolve at all.
    expect(deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES).url).toBe(
      "https://web-926-3000.prg1.zerops.app",
    );
  });

  it("ignores the transient build and prepare services the platform creates", () => {
    // Both observed in a real import; without the isSystem filter a service
    // named `buildwebv…` would be read as part of the recipe.
    const withBuilds = [
      service("buildwebv1788602355", "CREATING", { isSystem: true }),
      service("preparewebv11788602377", "ACTIVE", { isSystem: true }),
      ...RECIPE_SERVICES,
    ];
    expect(deriveGiteaState(GITEA_PROJECT, withBuilds).url).toBe(
      "https://web-926-3000.prg1.zerops.app",
    );
  });

  it("names the broker's address only once the import has created it, public", () => {
    const published = service("broker", "ACTIVE", { subdomainAccess: true });
    const withBroker = [...RECIPE_SERVICES.filter((entry) => entry.name !== "broker"), published];
    expect(deriveGiteaState(GITEA_PROJECT, withBroker).brokerUrl).toBe(
      "https://broker-926-8080.prg1.zerops.app",
    );
    const withoutBroker = RECIPE_SERVICES.filter((entry) => entry.name !== "broker");
    expect(deriveGiteaState(GITEA_PROJECT, withoutBroker).brokerUrl).toBeUndefined();
  });

  it("has no address before its web service is listed", () => {
    expect(deriveGiteaState(GITEA_PROJECT, []).url).toBeUndefined();
  });
});
