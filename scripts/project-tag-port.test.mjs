import { describe, expect, it } from "vite-plus/test";
import { planProjectTagPort } from "./project-tag-port.mjs";
import { originMateFaces } from "./port-mate-faces.ts";
const snapshot = {
  apps: [
    {
      id: "app",
      name: "HQ name",
      projects: [
        { projectId: "p", kind: "mate", mate: { face: "sky:flower", madeBy: "new-owner" } },
      ],
    },
  ],
  ungrouped: [],
  mates: {},
};
describe("the one-off project tag port", () => {
  it("removes every tag except exactly mate and fills only absent HQ facts", () => {
    const row = planProjectTagPort(
      {
        id: "p",
        name: "Zerops name",
        tags: [
          "mate",
          "mate:face:rose:seal",
          "mate:by:old-owner",
          "mate:signer:codex:user",
          "billing",
        ],
      },
      snapshot,
    );
    expect(row.remove).toEqual([
      "mate:face:rose:seal",
      "mate:by:old-owner",
      "mate:signer:codex:user",
      "billing",
    ]);
    expect(row.fill).toEqual([{ field: "signers.codex", value: "user" }]);
    expect(row.keep).toEqual(["mate"]);
  });
  it("maps an application's legacy id through a project id, never through its name", () => {
    const projects = [
      { id: "p", tags: ["mate:g:old"] },
      { id: "q", name: "different", tags: ["mate:g:old", "mate:role:stage"] },
    ];
    expect(planProjectTagPort(projects[1], snapshot, projects).membership).toEqual({
      appId: "app",
      kind: "stage",
    });
  });
  it("blocks ambiguous membership and unknown Mate metadata instead of losing it", () => {
    expect(
      planProjectTagPort(
        { id: "q", tags: ["mate", "mate:g:unknown", "mate:future:fact"] },
        snapshot,
      ).blocked,
    ).toEqual([
      "No HQ application id for legacy group unknown",
      "Unknown Mate metadata: mate:future:fact",
    ]);
  });
  it("does not invent a signer from a live HQ login or overwrite HQ's signer", () => {
    const read = {
      ...snapshot,
      mates: { p: { logins: { codex: { signedInBy: "hq-user", present: true, token: false } } } },
    };
    expect(
      planProjectTagPort({ id: "p", tags: ["mate", "mate:signer:codex:old-user"] }, read).fill,
    ).toEqual([]);
  });
});

import { runProjectTagPort } from "./project-tag-port.mjs";
import { vi } from "vite-plus/test";
describe("cleanup admission", () => {
  it("rechecks the allowlist on a fresh project read before writing HQ", async () => {
    let portCalls = 0;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const project = { id: "p", name: "mate-rig-one", orgId: "org", tags: ["billing"] };
    const api = {
      door: async () => "session",
      snapshot: async () => ({ apps: [], ungrouped: [], mates: {} }),
      api: async (_method, path) => {
        if (path === "/api/project-metadata/port") portCalls++;
        return { status: 200, json: { apps: [], ungrouped: [], mates: {} } };
      },
    };
    try {
      await expect(
        runProjectTagPort(["--apply"], {
          KRLS: "org",
          orgOf: () => ({ id: "org", name: "Test" }),
          actorOf: async () => "actor",
          projectsOf: async () => [project],
          hqOf: async () => ({ projectId: "hq" }),
          hqApi: () => api,
          assertWritable: (_org, p) => {
            if (!p.name.startsWith("mate-rig-")) throw new Error("refusing renamed project");
          },
          call: async () => ({
            status: 200,
            json: { id: "p", clientId: "org", name: "renamed", tagList: ["billing"] },
          }),
          mask: (value) => value,
        }),
      ).rejects.toThrow("refusing renamed project");
      expect(portCalls).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});

it("fills a missing face with the parallel face port's whole-org origin assignment", () => {
  const projects = [
    { id: "p", name: "New name", tags: ["mate", "mate:bot:Original"] },
    { id: "q", name: "Other", tags: ["mate"] },
  ];
  const expected = originMateFaces(projects).get("p");
  const read = { apps: [], ungrouped: [{ projectId: "p", mate: { face: "" } }], mates: {} };
  expect(planProjectTagPort(projects[0], read, projects).fill).toContainEqual({
    field: "face",
    value: expected,
  });
});
