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
          "medusa medusadev-a1b2-9000.prg1.zerops.app",
          "nextstore nextstoredev-a1b2-8000.prg1.zerops.app",
        ],
      },
      {
        title: "Preview",
        rows: [
          "medusa medusastage-a1b2-9000.prg1.zerops.app",
          "nextstore nextstorestage-a1b2-8000.prg1.zerops.app",
        ],
      },
      {
        title: "Production",
        rows: [
          "medusa medusa-c3d4-9000.prg1.zerops.app",
          "nextstore nextstore-c3d4-8000.prg1.zerops.app",
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
      "app",
      "app",
      "app",
    ]);
  });

  it("names each of a workspace's dev servers by its own name and port", () => {
    const input: MateAddressInput = {
      services: [
        {
          ...service("appdev"),
          devServers: [
            { name: "web", port: 3000, url: "https://appdev-a1b2-3000.prg1.zerops.app" },
            { name: "api", port: 8080, url: "https://appdev-a1b2-8080.prg1.zerops.app" },
          ],
        },
      ],
    };
    expect(shown(input)[0]).toEqual({
      title: "Development",
      rows: [
        "web :3000 appdev-a1b2-3000.prg1.zerops.app",
        "api :8080 appdev-a1b2-8080.prg1.zerops.app",
        "app appdev-a1b2-8000.prg1.zerops.app",
      ],
    });
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
      rows: ["app · EU app-eu.prg1.zerops.app", "app · US app-us.prg1.zerops.app"],
    });
  });
});
