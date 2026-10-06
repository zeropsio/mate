/**
 * The in-transit bridge feeds the account's inventory from the account's store: the organization's
 * projects as its roster lists them, in the data runtime's old shapes, and how current they are.
 */
import { describe, expect, it } from "vite-plus/test";

import type { OrganizationProjects } from "../../data/projections/projects.ts";
import { projectRecordToZeropsProject } from "../data/dto.ts";
import { interestKeyOf } from "../data/runtime.ts";
import { organization, project } from "../data/__fixtures__/index.ts";
import { organizationProjectsRead, projectRead } from "./projectBridge.ts";

const SHOP = {
  id: project().projectId,
  name: "shop",
  status: "ACTIVE",
  tagList: ["mate"],
  description: "the shop",
  publicZone: "x.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
  mode: "LIGHT",
};
const ROSTER: OrganizationProjects = {
  projects: [SHOP],
  read: "read",
  complete: true,
  live: true,
  reconnecting: false,
};

describe("organizationProjectsRead", () => {
  it("lists every project the roster lists, each its whole row", () => {
    const read = organizationProjectsRead(organization, ROSTER);
    expect(read.query.status).toBe("observed");
    const [entry] = read.value;
    expect(entry?.knowledge === "observed" && projectRecordToZeropsProject(entry.record)).toEqual({
      id: SHOP.id,
      clientId: organization.organizationId,
      name: "shop",
      status: "ACTIVE",
      tagList: ["mate"],
      description: "the shop",
      publicZone: "x.prg1-zerops.zone",
      zeropsSubdomainHost: "24cb",
      mode: "LIGHT",
    });
    // An unchanged project is the same record to every reader.
    expect(organizationProjectsRead(organization, ROSTER).value[0]).toEqual(entry);
  });

  it.each<{
    readonly name: string;
    readonly roster: Partial<OrganizationProjects>;
    readonly status: string;
    readonly query: string;
  }>([
    { name: "live", roster: {}, status: "observing", query: "observed" },
    {
      name: "its first read under way",
      roster: { read: "reading", live: false },
      status: "establishing",
      query: "unresolved",
    },
    {
      name: "catching up",
      roster: { live: false, reconnecting: true },
      status: "failed",
      query: "observed",
    },
    {
      name: "refused",
      roster: { live: false, unavailableReason: "forbidden" },
      status: "failed",
      query: "observed",
    },
  ])(
    "states the roster $name as the organization inventory's interest",
    ({ roster, status, query }) => {
      const read = organizationProjectsRead(organization, { ...ROSTER, ...roster });
      expect(read.query.status).toBe(query);
      expect(read.observation.required).toEqual([
        expect.objectContaining({
          status,
          identity: expect.objectContaining({
            key: interestKeyOf({ kind: "organization-inventory", organization }),
          }),
        }),
      ]);
    },
  );
});

describe("projectRead", () => {
  it("is the project's row while the store holds it, and unresolved while it does not", () => {
    expect(projectRead(project(), SHOP).value.knowledge).toBe("observed");
    expect(projectRead(project(), null).value).toEqual({ knowledge: "unresolved", ref: project() });
  });
});
