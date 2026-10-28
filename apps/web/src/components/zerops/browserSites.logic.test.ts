import { describe, expect, it } from "vite-plus/test";

import { mateAddresses, type MateAddressInput } from "~/zerops/mateAddresses.logic";
import { browserSiteGroups } from "./browserSites.logic";

type Service = MateAddressInput["services"][number];

const service = (hostname: string, port = 8000): Service => ({
  hostname,
  group: "runtimes",
  routes: [{ url: `https://${hostname}-a1b2-${String(port)}.prg1.zerops.app` }],
});

/** The Browser tab's read of nextstore's world: two apps in dev/preview pairs, mailpit, production. */
const NEXTSTORE: MateAddressInput = {
  services: [
    service("medusadev", 9000),
    service("medusastage", 9000),
    service("nextstoredev"),
    service("nextstorestage"),
    service("mailpit", 8025),
  ],
  environments: [
    {
      projectId: "p-prod",
      name: "nextstore production",
      role: "prod",
      routes: [
        { service: "medusa", url: "https://medusa-c3d4-9000.prg1.zerops.app" },
        { service: "nextstore", url: "https://nextstore-c3d4-8000.prg1.zerops.app" },
      ],
    },
  ],
};

/** What the list shows: each group's heading and its rows' names and hosts. */
const shown = (input: MateAddressInput) =>
  browserSiteGroups(mateAddresses(input)).map((group) => ({
    title: group.title,
    rows: group.rows.map((row) => `${row.name} ${row.address.host}`),
  }));

describe("browserSiteGroups", () => {
  it("groups a Mate's sites by environment, Development first and tools last, each row named by its service", () => {
    expect(shown(NEXTSTORE)).toEqual([
      {
        title: "Development",
        rows: [
          "Medusa medusadev-a1b2-9000.prg1.zerops.app",
          "Nextstore nextstoredev-a1b2-8000.prg1.zerops.app",
        ],
      },
      {
        title: "Preview",
        rows: [
          "Medusa medusastage-a1b2-9000.prg1.zerops.app",
          "Nextstore nextstorestage-a1b2-8000.prg1.zerops.app",
        ],
      },
      {
        title: "Production",
        rows: [
          "Medusa medusa-c3d4-9000.prg1.zerops.app",
          "Nextstore nextstore-c3d4-8000.prg1.zerops.app",
        ],
      },
      { title: "Tools", rows: ["mailpit mailpit-a1b2-8025.prg1.zerops.app"] },
    ]);
  });

  it("a group stage stands between the preview and production, and an empty group is never shown", () => {
    const input: MateAddressInput = {
      services: [service("appdev"), service("appstage")],
      environments: [
        {
          projectId: "p-stage",
          name: "shop stage",
          role: "stage",
          routes: [{ service: "app", url: "https://app-3aa1-8000.prg1.zerops.app" }],
        },
      ],
    };
    expect(shown(input).map((group) => group.title)).toEqual(["Development", "Preview", "Stage"]);
    expect(shown(input).map((group) => group.rows[0]!.split(" ")[0])).toEqual([
      "App",
      "App",
      "App",
    ]);
  });

  it("names a pool's workspaces by their part, and offers only those that run", () => {
    const input: MateAddressInput = {
      services: [{ ...service("webpool", 3001), type: "swarm@1" }, service("webstage")],
      leases: ["webpool-1", "webpool-2"].map((alias, index) => ({
        alias,
        pool: "webpool",
        state: "held",
        devServers: [
          {
            name: "web",
            port: 3001,
            status: index === 0 ? "running" : "starting",
            readAt: "2026-10-28T10:00:00Z",
            url: `https://webpool-${String(index + 1)}-a1b2-3001.prg1.zerops.app`,
          },
        ],
      })),
    };
    expect(shown(input).slice(0, 2)).toEqual([
      { title: "Development", rows: ["Web webpool-1-a1b2-3001.prg1.zerops.app"] },
      { title: "Preview", rows: ["Web webstage-a1b2-8000.prg1.zerops.app"] },
    ]);
  });

  it("two production projects keep their names beside the service", () => {
    const input: MateAddressInput = {
      services: [service("appdev")],
      environments: ["EU", "US"].map((region) => ({
        projectId: `p-${region}`,
        name: region,
        role: "prod" as const,
        routes: [{ service: "app", url: `https://app-${region.toLowerCase()}.prg1.zerops.app` }],
      })),
    };
    expect(shown(input)[1]).toEqual({
      title: "Production",
      rows: ["App · EU app-eu.prg1.zerops.app", "App · US app-us.prg1.zerops.app"],
    });
  });
});
