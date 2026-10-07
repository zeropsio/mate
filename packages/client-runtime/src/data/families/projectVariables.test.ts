import { describe, expect, it } from "vite-plus/test";

import { projectVariablesFamily } from "./projectVariables.ts";
import { serviceVariableFamily } from "./serviceVariables.ts";

const projectDecode = projectVariablesFamily.zeropsQuery!.decode;
const serviceDecode = serviceVariableFamily.zeropsQuery!.decode;

/** An env row as `POST /project/search` carries it on a project's `envList` (measured 2026-10-07). */
const envRow = (patch: Readonly<Record<string, unknown>>) => ({
  id: "e1",
  clientId: "org",
  projectId: "p1",
  key: "LOG_LEVEL",
  content: "debug",
  type: "USER",
  editable: true,
  sensitive: false,
  internal: false,
  created: "2026-10-07T10:00:00Z",
  lastUpdate: "2026-10-07T11:00:00Z",
  ...patch,
});

/** A row as `POST /user-data/search` answers it (measured 2026-10-07). */
const userDataRow = (patch: Readonly<Record<string, unknown>>) => ({
  _version: 3,
  id: "u1",
  clientId: "org",
  projectId: "p1",
  serviceStackId: "s1",
  serviceStackName: "appdev",
  key: "LOG_LEVEL",
  content: "debug",
  type: "USER",
  editable: true,
  sensitive: false,
  internal: false,
  created: "2026-10-07T10:00:00Z",
  lastUpdate: "2026-10-07T11:00:00Z",
  ...patch,
});

describe("projectVariablesFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads a project's variables off its row, keyed by the project",
      raw: {
        id: "p1",
        name: "rhea",
        envList: [
          envRow({}),
          envRow({
            id: "e2",
            key: "apiCdnUrl",
            content: "https://cdn",
            type: "SYSTEM",
            editable: false,
          }),
        ],
      },
      row: {
        id: "p1",
        version: null,
        value: {
          complete: true,
          rows: [
            {
              id: "e1",
              key: "LOG_LEVEL",
              type: "USER",
              editable: true,
              sensitive: false,
              value: "debug",
              created: "2026-10-07T10:00:00Z",
              lastUpdate: "2026-10-07T11:00:00Z",
            },
            {
              id: "e2",
              key: "apiCdnUrl",
              type: "SYSTEM",
              editable: false,
              sensitive: false,
              value: "https://cdn",
              created: "2026-10-07T10:00:00Z",
              lastUpdate: "2026-10-07T11:00:00Z",
            },
          ],
        },
      },
    },
    {
      name: "never keeps what a sensitive value's content says",
      raw: {
        id: "p1",
        envList: [
          envRow({ key: "STRIPE_KEY", content: "REDACTED", sensitive: true }),
          envRow({ id: "e2", key: "TOKEN", content: null, sensitive: true }),
          envRow({ id: "e3", key: "LEAKED", content: "sk_live", sensitive: true }),
        ],
      },
      row: {
        id: "p1",
        version: null,
        value: {
          complete: true,
          rows: [
            expect.objectContaining({ key: "STRIPE_KEY", sensitive: true, value: null }),
            expect.objectContaining({ key: "TOKEN", sensitive: true, value: null }),
            expect.objectContaining({ key: "LEAKED", sensitive: true, value: null }),
          ],
        },
      },
    },
    {
      name: "reads a project without variables as none",
      raw: { id: "p1", envList: [] },
      row: { id: "p1", version: null, value: { rows: [], complete: true } },
    },
    { name: "refuses a project row without its list", raw: { id: "p1" }, row: null },
    {
      name: "keeps the readable variables of a project one of whose is damaged, as incomplete",
      raw: { id: "p1", envList: [{ id: "e1" }, envRow({ id: "e2" })] },
      row: {
        id: "p1",
        version: null,
        value: { complete: false, rows: [expect.objectContaining({ id: "e2", key: "LOG_LEVEL" })] },
      },
    },
  ])("$name", ({ raw, row }) => {
    expect(projectDecode(raw)).toEqual(row);
  });

  it("asks for the one project, in its organization", () => {
    expect(projectVariablesFamily.zeropsQuery!.body({ orgId: "org", ownerId: "p1" })).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org" },
        { name: "id", operator: "eq", value: "p1" },
      ],
      sort: [],
      limit: 1,
    });
    expect(projectVariablesFamily.zeropsQuery!.frames).toBe("listing");
  });
});

describe("serviceVariableFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads a service's own value, keyed by its row",
      raw: userDataRow({}),
      row: {
        id: "u1",
        version: null,
        value: {
          serviceId: "s1",
          key: "LOG_LEVEL",
          type: "USER",
          editable: true,
          sensitive: false,
          value: "debug",
          created: "2026-10-07T10:00:00Z",
          lastUpdate: "2026-10-07T11:00:00Z",
        },
      },
    },
    {
      name: "keeps a deployed zerops.yml entry's template unresolved",
      raw: userDataRow({ key: "DB_URL", content: "postgres://${db_user}@db", editable: false }),
      row: expect.objectContaining({
        value: expect.objectContaining({ editable: false, value: "postgres://${db_user}@db" }),
      }),
    },
    {
      name: "never keeps a sensitive value's REDACTED",
      raw: userDataRow({ key: "password", content: "REDACTED", type: "SYSTEM", sensitive: true }),
      row: expect.objectContaining({
        value: expect.objectContaining({ sensitive: true, value: null }),
      }),
    },
    {
      name: "reads a row whose times are unsaid as unknown times",
      raw: userDataRow({ created: undefined, lastUpdate: null }),
      row: expect.objectContaining({
        value: expect.objectContaining({ created: null, lastUpdate: null }),
      }),
    },
    {
      name: "refuses a row without its service",
      raw: userDataRow({ serviceStackId: undefined }),
      row: null,
    },
    { name: "refuses a row without its key", raw: userDataRow({ key: undefined }), row: null },
  ])("$name", ({ raw, row }) => {
    expect(serviceDecode(raw)).toEqual(row);
  });

  it("asks for every service's rows of the one project, whole", () => {
    expect(serviceVariableFamily.zeropsQuery!.body({ orgId: "org", ownerId: "p1" })).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org" },
        { name: "projectId", operator: "eq", value: "p1" },
      ],
      sort: [],
      limit: 2000,
    });
    expect(serviceVariableFamily.zeropsQuery!.frames).toBe("listing");
  });
});
