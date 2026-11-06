import { describe, expect, it } from "vite-plus/test";

import { projectVariablesFamily } from "./projectVariables.ts";
import { serviceVariableFamily } from "./serviceVariables.ts";

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
  it("never keeps a sensitive value's REDACTED", () => {
    const raw = userDataRow({
      key: "password",
      content: "REDACTED",
      type: "SYSTEM",
      sensitive: true,
    });
    const row = expect.objectContaining({
      value: expect.objectContaining({ sensitive: true, value: null }),
    });
    expect(serviceVariableFamily.zeropsQuery!.decode(raw)).toEqual(row);
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
