import { describe, expect, it } from "vite-plus/test";

import { projectFamily } from "./project.ts";

const decode = projectFamily.zerops!.decode;

describe("projectFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps the whole row: its organization, tags, words and placement",
      raw: {
        id: "p1",
        clientId: "org",
        name: "Shop",
        status: "ACTIVE",
        created: "2026-10-05T18:49:08Z",
        description: "Preserve user description",
        tagList: ["custom", "mate:agent:Pia"],
        publicZone: "fte2334ab.prg1-zerops.zone",
        zeropsSubdomainHost: "24cb",
        mode: "LIGHT",
        userRoles: [{ clientUserId: "cu-1", roleCode: "OWNER" }],
        _version: 7,
      },
      row: {
        id: "p1",
        version: 7,
        value: {
          id: "p1",
          clientId: "org",
          name: "Shop",
          status: "ACTIVE",
          created: "2026-10-05T18:49:08Z",
          description: "Preserve user description",
          tagList: ["custom", "mate:agent:Pia"],
          publicZone: "fte2334ab.prg1-zerops.zone",
          zeropsSubdomainHost: "24cb",
          mode: "LIGHT",
          userRoles: [{ clientUserId: "cu-1", roleCode: "OWNER" }],
        },
      },
    },
    {
      name: "leaves out what the row leaves null, and orders by nothing without a version",
      raw: { id: "p1", name: "Shop", status: "NEW", description: null, publicZone: null },
      row: { id: "p1", version: null, value: { id: "p1", name: "Shop", status: "NEW" } },
    },
    { name: "refuses a row without its name", raw: { id: "p1", status: "ACTIVE" }, row: null },
    { name: "refuses a row without its status", raw: { id: "p1", name: "Shop" }, row: null },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});
